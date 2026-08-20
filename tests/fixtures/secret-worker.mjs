import { createSecretBox } from "../../server/secrets.js";

const [secretFile, indexRaw] = process.argv.slice(2);
const index = Number(indexRaw);

process.stdout.write("ready\n");
process.stdin.once("data", () => {
  try {
    const box = createSecretBox(secretFile);
    const cleartext = `worker-${index}`;
    process.stdout.write(
      JSON.stringify({ index, cleartext, payload: box.encrypt(cleartext) }) + "\n"
    );
  } catch (error) {
    process.stdout.write(JSON.stringify({ index, error: error.message }) + "\n");
  }
});
