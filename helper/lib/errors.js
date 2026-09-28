export class HelperError extends Error {
  constructor(kind, message, status = 502) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}
