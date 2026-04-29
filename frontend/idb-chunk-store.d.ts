declare module "idb-chunk-store" {
  export default class IndexedDBChunkStore {
    constructor(chunkLength: number, opts?: Record<string, unknown>);
  }
}
