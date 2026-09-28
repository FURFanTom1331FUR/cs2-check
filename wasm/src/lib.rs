//! Тонкая wasm-обёртка над парсером demoparser2 (https://github.com/LaihoE/demoparser, MIT).
//! Демка загружается в память wasm один раз (DemoBytes) и может разбираться несколько раз:
//! этап 2 — события матча, этап 3 — позиции игроков по тикам (parseTicks) для 2D-реплея.
use ahash::AHashMap;
use parser::first_pass::parser_settings::{rm_user_friendly_names, ParserInputs};
use parser::parse_demo::{Parser, ParsingMode};
use parser::second_pass::parser_settings::create_huffman_lookup_table;
use parser::second_pass::variants::{PropColumn, VarVec};
use serde::Serialize;
use serde_json::{json, Map, Value};
use wasm_bindgen::prelude::*;

/// Буфер с байтами демки внутри памяти wasm. JS пишет в него файл кусками (без двойного копирования).
#[wasm_bindgen]
pub struct DemoBytes {
    data: Vec<u8>,
}

#[wasm_bindgen]
impl DemoBytes {
    #[wasm_bindgen(constructor)]
    pub fn new(len: usize) -> Result<DemoBytes, JsError> {
        let mut data = Vec::new();
        data.try_reserve_exact(len)
            .map_err(|_| JsError::new("OOM: не удалось выделить память под демку"))?;
        data.resize(len, 0);
        Ok(DemoBytes { data })
    }
    pub fn ptr(&mut self) -> *mut u8 {
        self.data.as_mut_ptr()
    }
    pub fn len(&self) -> usize {
        self.data.len()
    }
}

fn inputs<'a>(
    huf: &'a Vec<(u8, u8)>,
    events: Vec<String>,
    player_props: &[String],
    other_props: &[String],
    ticks: Vec<i32>,
) -> Result<ParserInputs<'a>, JsError> {
    let real_player = rm_user_friendly_names(&player_props.to_vec()).map_err(|e| JsError::new(&format!("{e}")))?;
    let real_other = rm_user_friendly_names(&other_props.to_vec()).map_err(|e| JsError::new(&format!("{e}")))?;
    let mut names = AHashMap::default();
    for (r, o) in real_player.iter().zip(player_props) {
        names.insert(r.clone(), o.clone());
    }
    for (r, o) in real_other.iter().zip(other_props) {
        names.insert(r.clone(), o.clone());
    }
    Ok(ParserInputs {
        real_name_to_og_name: names,
        wanted_players: vec![],
        wanted_player_props: real_player,
        wanted_other_props: real_other,
        wanted_prop_states: AHashMap::default(),
        wanted_ticks: ticks,
        wanted_events: events,
        parse_ents: true,
        parse_projectiles: false,
        parse_grenades: false,
        only_header: false,
        only_convars: false,
        huffman_lookup_table: huf,
        order_by_steamid: false,
        list_props: false,
        fallback_bytes: None,
    })
}

fn map_json(m: Option<&AHashMap<String, String>>) -> Value {
    match m {
        Some(m) => Value::Object(m.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect()),
        None => Value::Null,
    }
}

fn to_json<T: Serialize>(v: &T) -> Result<String, JsError> {
    serde_json::to_string(v).map_err(|e| JsError::new(&format!("{e}")))
}

/// Заголовок демки (карта, сервер, билд). Быстро: читает только начало файла.
#[wasm_bindgen(js_name = parseHeader)]
pub fn parse_header(demo: &DemoBytes) -> Result<String, JsError> {
    let huf = create_huffman_lookup_table();
    let mut i = inputs(&huf, vec![], &[], &[], vec![])?;
    i.only_header = true;
    i.parse_ents = false;
    let out = Parser::new(i, ParsingMode::ForceSingleThreaded)
        .parse_demo(&demo.data)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    to_json(&map_json(out.header.as_ref()))
}

/// События матча с дополнительными свойствами игроков/игры на тике события.
/// Возвращает JSON: { header, events: [...], players: [...], roster: [...] }.
#[wasm_bindgen(js_name = parseEvents)]
pub fn parse_events(
    demo: &DemoBytes,
    events: Vec<String>,
    player_props: Vec<String>,
    other_props: Vec<String>,
) -> Result<String, JsError> {
    let huf = create_huffman_lookup_table();
    let i = inputs(&huf, events, &player_props, &other_props, vec![])?;
    let out = Parser::new(i, ParsingMode::ForceSingleThreaded)
        .parse_demo(&demo.data)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let players = |v: &Vec<parser::second_pass::parser_settings::PlayerEndMetaData>| -> Value {
        Value::Array(
            v.iter()
                .map(|p| json!({ "steamid": p.steamid.map(|s| s.to_string()), "name": p.name, "team": p.team_number }))
                .collect(),
        )
    };
    let body = json!({
        "header": map_json(out.header.as_ref()),
        "events": out.game_events,
        "players": players(&out.player_md),
        "roster": players(&out.roster),
        "convars": map_json(Some(&out.convars)),
    });
    to_json(&body)
}

/// Свойства игроков на выбранных тиках (для 2D-реплея, этап 3). JSON в виде «структуры массивов».
#[wasm_bindgen(js_name = parseTicks)]
pub fn parse_ticks(demo: &DemoBytes, props: Vec<String>, ticks: Vec<i32>) -> Result<String, JsError> {
    let huf = create_huffman_lookup_table();
    let mut wanted = props.clone();
    for extra in ["tick", "steamid", "name"] {
        if !wanted.iter().any(|p| p == extra) {
            wanted.push(extra.to_string());
        }
    }
    let i = inputs(&huf, vec![], &wanted, &[], ticks)?;
    let out = Parser::new(i, ParsingMode::ForceSingleThreaded)
        .parse_demo(&demo.data)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    let mut cols = Map::new();
    for (id, col) in out.df.iter() {
        let pc = &out.prop_controller;
        let name = match special_name(*id) {
            Some(n) => n.to_string(),
            None => {
                let real = pc.id_to_name.get(id).cloned().unwrap_or_else(|| id.to_string());
                pc.real_name_to_og_name.get(&real).cloned().unwrap_or(real)
            }
        };
        cols.insert(name, column_to_json(col));
    }
    to_json(&Value::Object(cols))
}

fn column_to_json(col: &PropColumn) -> Value {
    match &col.data {
        Some(VarVec::F32(v)) => json!(v),
        Some(VarVec::I32(v)) => json!(v),
        Some(VarVec::U32(v)) => json!(v),
        Some(VarVec::Bool(v)) => json!(v),
        Some(VarVec::String(v)) => json!(v),
        Some(VarVec::U64(v)) => Value::Array(v.iter().map(|x| x.map(|s| Value::String(s.to_string())).unwrap_or(Value::Null)).collect()),
        _ => Value::Null,
    }
}

/// Служебные свойства парсера имеют числовые id (см. prop_controller.rs).
fn special_name(id: u32) -> Option<&'static str> {
    use parser::first_pass::prop_controller::*;
    Some(match id {
        IS_ALIVE_ID => "is_alive",
        GAME_TIME_ID => "game_time",
        TICK_ID => "tick",
        STEAMID_ID => "steamid",
        NAME_ID => "name",
        PLAYER_X_ID => "X",
        PLAYER_Y_ID => "Y",
        PLAYER_Z_ID => "Z",
        YAW_ID => "yaw",
        PITCH_ID => "pitch",
        VELOCITY_ID => "velocity",
        WEAPON_NAME_ID => "active_weapon_name",
        USERID_ID => "user_id",
        ENTITY_ID_ID => "entity_id",
        _ => return None,
    })
}
