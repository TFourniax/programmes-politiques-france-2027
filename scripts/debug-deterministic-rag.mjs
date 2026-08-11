import { retrieveDeterministic } from '../lib/retrieval-v2.js';

for (const question of [
  "Qui veut remplacer la sélection post-bac actuelle par un autre système public ?",
  "Qui veut couper l'accès numérique des mineurs pendant la nuit ?",
  "Qui veut permettre aux métiers pénibles de partir plus tôt à la retraite ?"
]) {
  const result = retrieveDeterministic(question, { limit: 8 });
  console.log('DEBUG_DETERMINISTIC=' + JSON.stringify({
    question,
    debug: result.debug,
    results: result.results.slice(0, 5).map((item) => ({score:item.score,path:item.citation.path,match:item.match}))
  }));
}
