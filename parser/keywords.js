// Body of the Split Keywords n8n Code node.
// Pure module — `module.exports.splitKeywords` returns the n8n item array.

const KEYWORDS = ['tasak', 'hirschfanger', 'pruski'];
const ALLEGRO_CATEGORY_ID = '3690';
const LOKALNIE_CATEGORY_PATH = 'bron/bron-biala-3691';

function splitKeywords() {
  return KEYWORDS.map(keyword => ({
    json: {
      keyword,
      allegroCategoryId: ALLEGRO_CATEGORY_ID,
      lokalnieCategoryPath: LOKALNIE_CATEGORY_PATH,
    },
  }));
}

module.exports = { splitKeywords, KEYWORDS, ALLEGRO_CATEGORY_ID, LOKALNIE_CATEGORY_PATH };