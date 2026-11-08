// The Claude Code backend's only way to touch the computer: node scripts/oculus-hands.mjs <action> '<json input>'.
// It forwards to the running Oculus Agent, which hides the overlay for screenshots and performs the input.
const [name, json = '{}'] = process.argv.slice(2);
const { OCULUS_HANDS_URL: url, OCULUS_HANDS_TOKEN: token } = process.env;

if (!name || !url || !token) {
  console.log(JSON.stringify({ ok: false, error: 'Usage: oculus-hands.mjs <action> <json input>, run by the Oculus Agent' }));
  process.exit(1);
}

let input;
try {
  input = JSON.parse(json);
} catch {
  console.log(JSON.stringify({ ok: false, error: `Input is not JSON: ${json}` }));
  process.exit(1);
}

const response = await fetch(url, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ name, input }),
});
const reply = await response.json();
console.log(JSON.stringify(reply));
process.exit(reply.ok ? 0 : 1);
