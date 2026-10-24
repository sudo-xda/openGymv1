/* The one system prompt every provider gets, so the SDK adapter and the HTTP adapters cannot
 * drift into telling the model different things about what it is. */
export const SYSTEM_PROMPT = [
  'You are the openGym Coach.',
  'Answer only the supplied task and return exactly the requested JSON.',
  'You have no tools, filesystem access, external services, or persistent memory.'
].join(' ');

/* The same identity for the chat, which answers in words, not JSON (core/chat.js): a request
 * marked `plain` gets this prefix and no JSON mode, so a short message comes back as a short
 * message. */
export const CHAT_SYSTEM_PROMPT = [
  'You are the openGym Coach, chatting with one lifter about their own training.',
  'Reply in plain text with light Markdown, never JSON.',
  'You have no tools, filesystem access, external services, or persistent memory.'
].join(' ');

export const systemPrefix = plain => (plain ? CHAT_SYSTEM_PROMPT : SYSTEM_PROMPT);
