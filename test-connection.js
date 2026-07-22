import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const message = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 64,
  messages: [{ role: "user", content: "Say hello in one sentence." }],
});

console.log(message.content[0].text);
