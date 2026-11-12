export {
  type AnswerMessageDeps,
  type AnswerMessageResult,
  answerMessage,
  ConversationBusyError,
  MAX_CUSTOMER_MESSAGES,
} from './answer-message.ts';
export { type Answer, answerSchema } from './answer-schema.ts';
export {
  type AccountChoice,
  generateCode,
  hashCode,
  hashEmail,
  type LoginDeps,
  lookupAccounts,
  type OtpConfig,
  requestLoginCode,
  selectAccount,
  type VerifyOutcome,
  verifyLoginCode,
} from './auth/login.ts';
export {
  type AccountContext,
  availableCapabilities,
  CAPABILITIES,
  type Capability,
  type CapabilityDeps,
  runCapability,
  toolDefinitions,
} from './capabilities/catalogue.ts';
export {
  type Answerer,
  type AnswererResult,
  type CreateClient,
  createClaudeAnswerer,
} from './claude-answerer.ts';
export {
  finalizeReply,
  type Reply,
  type ReplyAction,
  sanitizeAnswerText,
} from './finalize-reply.ts';
export { buildUserTurn, escapeForPrompt, SYSTEM_PROMPT } from './prompt.ts';
export {
  MAX_REPLAY_QUESTIONS,
  REPLAY_PROFILES,
  type ReplayDeps,
  replayConversation,
} from './replay.ts';
export * from './report/index.ts';
export { buildTicketNote, MAX_NOTE_MESSAGES } from './ticket-note.ts';
