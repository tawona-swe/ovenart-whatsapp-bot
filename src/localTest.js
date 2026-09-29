// Chat with the order flow in the terminal, no WhatsApp/Meta credentials needed.
// Run: node src/localTest.js
//
// The order flow sends real interactive messages via whatsapp.js (which needs
// live Meta credentials), so this stubs that module in the require cache with
// terminal-printing versions before orderFlow.js is loaded.
require("dotenv").config();
const readline = require("readline");

const whatsappPath = require.resolve("./whatsapp");
require.cache[whatsappPath] = {
  id: whatsappPath,
  filename: whatsappPath,
  loaded: true,
  exports: {
    sendText: async (_to, body) => console.log(`\n🤖 ${body}\n`),
    sendTemplate: async (_to, name) => console.log(`\n🤖 [template message: "${name}"]\n`),
    sendFlow: async (_to, body) => console.log(`\n🤖 [flow trigger] ${body}\n`),
    sendList: async (_to, body, buttonText, sections) => {
      console.log(`\n🤖 ${body}`);
      console.log(`   [ ${buttonText} ]`);
      for (const section of sections) {
        console.log(`   — ${section.title} —`);
        for (const row of section.rows) {
          const desc = row.description ? ` — ${row.description}` : "";
          console.log(`   • ${row.title}${desc}   (reply: ${row.id})`);
        }
      }
      console.log();
    },
    sendButtons: async (_to, body, buttons) => {
      console.log(`\n🤖 ${body}`);
      for (const b of buttons) {
        console.log(`   [ ${b.title} ]   (reply: ${b.id})`);
      }
      console.log();
    },
  },
};

const { handleIncoming } = require("./orderFlow");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const phone = "263700000000";

console.log("Type a message, or an id shown in [brackets]/(reply: ...) to simulate tapping it. Ctrl+C to quit.\n");

function prompt() {
  rl.question("you> ", async (text) => {
    await handleIncoming(phone, text);
    prompt();
  });
}

handleIncoming(phone, "hi").then(prompt);
