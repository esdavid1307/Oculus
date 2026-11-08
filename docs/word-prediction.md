# Word prediction

The Gaze Keyboard offers up to three Suggested Words above the letter groups, and the scan reaches them first. Choosing one with a Select Blink types the whole word and a space. After a space, the Suggested Words predict the next word.

On a scanning keyboard every letter costs two selections and a wait, so this is the biggest speed-up there is. A word that is suggested first costs one blink.

## How it predicts

1. **Candidates** come from 15,000 words of spoken English (`src/main/words/spoken-english.json`, from SUBTLEX via `subtlex-word-frequencies`, ISC) and from the user's own words.
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
