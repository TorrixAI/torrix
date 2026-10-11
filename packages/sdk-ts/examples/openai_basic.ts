import OpenAI from "openai";
import * as torrix from "../src/index.js";

torrix.init(process.env.TORRIX_API_KEY ?? "trxk_replace_me", process.env.TORRIX_URL ?? "http://localhost:8088");

const client = new OpenAI();
torrix.wrap(client);

const run = await torrix.runContext({ sessionId: "example-session", agentName: "example" }, async () => {
  return client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Say hello in one short sentence." }],
  });
});

console.log(run.choices[0]?.message?.content);
await torrix.flush();
console.log("torrix stats:", torrix.stats());
