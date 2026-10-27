/**
 * Builds a newline-delimited JSON (NDJSON) payload for the Elasticsearch `_bulk` API,
 * emitting one `update` action per record with both a partial `doc` and an `upsert`
 * so missing documents are created. Each record becomes an action line followed by
 * a source line, and the payload ends with a trailing newline as the bulk API requires.
 *
 * Records missing `idField` are silently skipped.
 *
 * @param indexName - The target index for every update action.
 * @param records - The documents to upsert; entries missing `idField` are omitted.
 * @param idField - The property used as each document's `_id`. Defaults to `'domain_ip'`.
 * @returns The NDJSON payload, terminated by a newline.
 */
function buildBulkUpdatePayload( indexName: string, records: Array<Record<string, any>>, idField = 'domain_ip'): string {
 
    const ndjson = records.map(record => {
      const id = record[idField]

      if (id == null) return [] 

      const action = JSON.stringify({
        update: {
          _index: indexName,
          _id: id
        },
      });

      const source = JSON.stringify({
        doc: record,
        upsert: record
      });

      return `${action}\n${source}`;
    }).join('\n') + '\n'

  return ndjson
}

// header
// Content-Type: application/x-ndjson

// http request
// POST /_bulk
