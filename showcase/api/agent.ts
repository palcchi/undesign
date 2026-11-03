import { createAgentHandler } from './_lib/agent-handler.js';

export const config = { api: { bodyParser: false } };
export default createAgentHandler();
