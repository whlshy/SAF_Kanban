// A failure with a message the user can act on; shown as is (see main.jsx).
export class DataError extends Error {
  constructor(userMessage) {
    super(userMessage)
    this.userMessage = userMessage
  }
}
