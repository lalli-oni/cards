<script lang="ts">
  import { createInstanceCounter, type CardDefinition } from "cards-engine";
  import cardDefs from "../../../library/build/all.json";

  const counter = createInstanceCounter();
  const defs = cardDefs as CardDefinition[];
</script>

<main>
  <h1>Cards</h1>
  <p>Engine import: createInstanceCounter() → {JSON.stringify(counter)}</p>
  <p>Card library: {defs.length} definitions loaded</p>
</main>
