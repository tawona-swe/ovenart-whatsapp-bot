// Chat with the order flow in the terminal, no WhatsApp/Meta credentials needed.
// Run: node src/localTest.js
require("dotenv").config();
const readline = require("readline");
const { handleIncoming } = require("./orderFlow");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const phone = "test-customer";

console.log("Type a message to the bot (Ctrl+C to quit).\n");

async function prompt() {
  rl.question("you> ", async (text) => {
    const reply = await handleIncoming(phone, text);
    console.log(`\nbot> ${reply}\n`);
    prompt();
  });
}

// Kick things off the way a fresh WhatsApp conversation would: any first
// message triggers the welcome menu.
handleIncoming(phone, "hi").then((reply) => {
  console.log(`bot> ${reply}\n`);
  prompt();
});
