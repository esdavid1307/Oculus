# Word prediction

The Gaze Keyboard offers up to three Suggested Words above the letter groups, and the scan reaches them first. Choosing one with a Select Blink types the whole word and a space. After a space, the Suggested Words predict the next word.

On a scanning keyboard every letter costs two selections and a wait, so this is the biggest speed-up there is. A word that is suggested first costs one blink.

## How it predicts

1. **Candidates** come from the 15,000 most common words of spoken English (`src/main/words/spoken-english.json`, from SUBTLEX via `subtlex-word-frequencies`, ISC), and from the user's own words. Contraction pieces such as "don", strong swearing and slurs are removed from the list, because one blink would type them.
2. **Seven features** describe each candidate:
   - how common it is in spoken English
   - how often this user confirmed it
   - how recently they used it
   - how often it followed the previous word
   - its share of the words that followed the previous word
   - letters saved
   - whether it's already earlier in the text
3. **A small neural ranker** scores the candidates: a linear layer plus 8 tanh units, written out in `src/shared/predict.ts` with no dependencies. It starts from hand-set weights, so it predicts well before it has learned anything.

Suggesting takes about 0.2 ms, so it runs on every press.

## How it learns

Only text confirmed with Done teaches it. Text closed by the Stop Gesture never reaches it.

For every confirmed word it does two things:

- **Counts it:** how often, when, and after which word. A new word, such as a name, is suggested after a single use.
- **Replays it as it was typed:** with no letters, then one, two and three. Each time, the ranker trains to put that word first among everything it would have shown. That's several training examples per word, which is why it adapts in minutes.

The ranker is pulled gently back towards its starting weights, so a few odd sentences can't wreck it.

## Results

A unit test types five phrases a user might repeat. It counts selections as letters, spaces and picked suggestions, ignoring the two-step groups:

| | Selections |
|---|---|
| Every letter typed | 95 |
| Fresh model | 47 |
| After each phrase was confirmed once | 19 |

In the app on the demo laptop, with the dev select shortcut, "i need water" took 14 selections the first time. The second time it took 4, each the first key scanned: i, need, water, Done.

## Settings and privacy

- `"wordPrediction": false` in `~/Library/Application Support/oculus-agent/config.json` switches it off.
- What it learns is saved to `word-model.json` in the same folder: the user's words, which word followed which, and the ranker's weights. It never leaves the machine. Delete the file to start fresh.

Known limits:

- Lower-case letters only, because the keyboard has no apostrophe or capitals. Contractions such as "don't" can't be suggested.
- There's no on-screen reset yet. The file has to be deleted.
- Suggested Intents (#28) could rank their choices with the same approach.

## Suggested Phrase

Every text confirmed with Done is also remembered whole. Once 2 or more typed letters match the start of a remembered text (ignoring case), the keyboard offers it as a Suggested Phrase in a wide row above the Suggested Words, so the scan reaches it first. Choosing it replaces everything typed so far, so a message sent often takes one blink. Up to two phrases are offered, each in its own wide row, ranked by how often and how recently they were sent. No phrase is offered on an empty keyboard, after a single letter, or on the letter screens.

Privacy:

- Text with a space-free run of 16 or more characters looks like a password, key or code, and is never learned, words included.
- At Done, before learning, Oculus asks System Events for the focused field's subrole. A secure text field (`AXSecureTextField`) teaches nothing. If the subrole can't be read, nothing is learned.
- Text closed by the Stop Gesture is never learned.
- `"wordPrediction": false` turns phrases off along with words.

Phrases live in the same `word-model.json`, in a new optional `phrases` field, so files saved before phrases still load. Up to 200 are kept, the least used going first.
