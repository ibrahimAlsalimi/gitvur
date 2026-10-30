# Comprehension test

Repository: `psf/black` at `408211f`. Six questions in two sets of three. Each set has one
orientation question, one relationship question and one locate-or-history question, so the
sets are about equally hard.

## How to run it

1. Flip a coin. Heads: answer **set A with Gitvur and set B with your editor**. Tails: the
   reverse. Write the outcome below.
2. **Gitvur**: open the Black clone in the app, with `.gitvur/` holding the documenter's
   `annotations.json` (`eval/documenter/initial/`). Use only the app: map, search, inspector,
   lenses, Changes view.
3. **Editor**: the same clone in your usual editor, with its normal search and go-to-definition,
   plus `git` on the command line. No Gitvur and no AI assistant.
4. For each question, start a timer when you have read it and stop it when you've written
   your answer. Stop at **5 minutes** and write "timeout".
5. Don't look at `comprehension-key.md` until all six are done. Then mark each answer correct
   (`y`), partly correct (`partial`) or wrong (`n`).
6. You haven't worked on Black before, which is the point. If you have, note it below.

Coin: ______  → Set A with: ______  Set B with: ______

Prior familiarity with Black's code: ______

## Set A

- **A1.** Where does the program start? Name the function that runs when you type `black` in a
  terminal, and its file.
- **A2.** Who calls `format_file_contents` (in `src/black/__init__.py`)? List the callers
  outside the tests.
- **A3.** Where does Black write a reformatted file back to disk? Name the function and file.

## Set B

- **B1.** Which module handles caching of files that are already formatted? Name the file
  (and, in Gitvur, the logical module).
- **B2.** If you change the class `Mode` (in `src/black/mode.py`), what is affected? Name the
  main parts of the code that depend on it.
- **B3.** What changed structurally between commits `6f8e43f` and `408211f`? List the
  functions added and anything removed.

## Answers and timing

| Q | Tool (Gitvur / editor) | Time (m:ss) | Answer (short) | Correct (y / partial / n) | Comment |
| --- | --- | --- | --- | --- | --- |
| A1 | | | | | |
| A2 | | | | | |
| A3 | | | | | |
| B1 | | | | | |
| B2 | | | | | |
| B3 | | | | | |

## Totals (fill after marking)

| | Gitvur | Editor |
| --- | --- | --- |
| Total time | | |
| Correct (y = 1, partial = 0.5) | | |
| Timeouts | | |

Notes (what helped, what got in the way):
