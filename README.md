# Card Game Project

This repository houses a card game [name pending] with the following aspects:

1. Completely free. Only monetization is through donations, if I can be bothered.
2. Collectible. New card packs will be released and cards gained through packs.
3. Any number of players. Single player and multiplayer with a cap of 8 players [subject to change].
4. Variants. The game allows for any number of variants. The default variant called `Baseline` will give us a starting point for others. Examples of future variants: `Fair` (optimizes fairness between players with different card collections), `Chaos` (more RNG oriented, opens for stronger synergies), `Competitive` (less RNG oriented, more deterministic, presses player skills), `Cooperative` (players play towards a common goal)
5. Challenging. Complex in ways that challenges players. Like reacting to changing conditions or spotting valuable synergies.
6. De-coupled. The rules are as de-coupled from the engine as much as possible (among other things allowing maximum customization of rules through variants). Clients and test runner are also de-coupled from the engine and import it as a dependency.


## Project Structure

The project is organized into the following main directories:

- **rules/**: Contains the `Baseline` rules of the card game, detailing gameplay mechanics, objectives, and any special rules. Includes variants which can be loaded to override `Baseline` rules. Loaded by engine.
- **engine/**: Game engine. Processes game logic. Library used by clients and test runner. Loads rules.
- **test/**: Runs tests using the engine. Also handles running balance testing, collecting full game statistics for balancing and game design decisions.
- **library/**: Contains all card definitions.
- **clients/**: Various game clients. For example: game web app, card design tool.
