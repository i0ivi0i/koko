import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type 媒体Tus历史上传 = {
  size: number | null;
  metadata: Record<string, string>;
  creationTime: string;
  urlStorageKey: string;
  uploadUrl: string | null;
  parallelUploadUrls: string[] | null;
};

type 媒体Tus断点记录 = 媒体Tus历史上传 & {
  fingerprint: string;
};

export type 待保存媒体Tus历史上传 = Partial<媒体Tus历史上传> & {
  metadata?: Record<string, string>;
};

export type 媒体Tus断点UrlStorage = {
  findAllUploads(): Promise<媒体Tus历史上传[]>;
  findUploadsByFingerprint(fingerprint: string): Promise<媒体Tus历史上传[]>;
  removeUpload(urlStorageKey: string): Promise<void>;
  addUpload(fingerprint: string, upload: 待保存媒体Tus历史上传): Promise<string>;
};

interface 媒体Tus断点数据库定义 extends DBSchema {
  uploads: {
    key: string;
    value: 媒体Tus断点记录;
    indexes: {
      byFingerprint: string;
    };
  };
}

const 媒体Tus断点数据库名称 = "koko-tus-resume";
const 媒体Tus断点数据库版本 = 1;
const 媒体Tus断点存储名 = "uploads";
const 媒体Tus断点Fingerprint索引名 = "byFingerprint";

const 生成媒体Tus断点键 = (fingerprint: string): string => {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1e12)}`;
  return `koko-tus::${fingerprint}::${randomPart}`;
};

const 复制媒体Tus历史上传 = (record: 媒体Tus断点记录): 媒体Tus历史上传 => ({
  size: record.size,
  metadata: { ...record.metadata },
  creationTime: record.creationTime,
  urlStorageKey: record.urlStorageKey,
  uploadUrl: record.uploadUrl,
  parallelUploadUrls: record.parallelUploadUrls ? [...record.parallelUploadUrls] : null,
});

const 规范化媒体Tus断点记录 = (
  fingerprint: string,
  urlStorageKey: string,
  upload: 待保存媒体Tus历史上传
): 媒体Tus断点记录 => ({
  fingerprint,
  urlStorageKey,
  size: typeof upload.size === "number" && Number.isFinite(upload.size) ? upload.size : null,
  metadata: upload.metadata ? { ...upload.metadata } : {},
  creationTime: typeof upload.creationTime === "string" ? upload.creationTime : new Date().toString(),
  uploadUrl: typeof upload.uploadUrl === "string" ? upload.uploadUrl : null,
  parallelUploadUrls: Array.isArray(upload.parallelUploadUrls)
    ? upload.parallelUploadUrls.filter((url): url is string => typeof url === "string")
    : null,
});

const 创建内存媒体Tus断点存储 = (): 媒体Tus断点UrlStorage => {
  const records = new Map<string, 媒体Tus断点记录>();
  return {
    async findAllUploads(): Promise<媒体Tus历史上传[]> {
      return Array.from(records.values()).map(复制媒体Tus历史上传);
    },

    async findUploadsByFingerprint(fingerprint: string): Promise<媒体Tus历史上传[]> {
      return Array.from(records.values())
        .filter((record) => record.fingerprint === fingerprint)
        .map(复制媒体Tus历史上传);
    },

    async removeUpload(urlStorageKey: string): Promise<void> {
      records.delete(urlStorageKey);
    },

    async addUpload(
      fingerprint: string,
      upload: 待保存媒体Tus历史上传
    ): Promise<string> {
      const urlStorageKey = 生成媒体Tus断点键(fingerprint);
      records.set(urlStorageKey, 规范化媒体Tus断点记录(fingerprint, urlStorageKey, upload));
      return urlStorageKey;
    },
  };
};

const 创建IndexedDB媒体Tus断点存储 = (): 媒体Tus断点UrlStorage | null => {
  if (typeof indexedDB === "undefined") {
    return null;
  }
  let 数据库Promise: Promise<IDBPDatabase<媒体Tus断点数据库定义>> | null = null;
  const 读取数据库 = (): Promise<IDBPDatabase<媒体Tus断点数据库定义>> => {
    if (!数据库Promise) {
      数据库Promise = openDB<媒体Tus断点数据库定义>(
        媒体Tus断点数据库名称,
        媒体Tus断点数据库版本,
        {
          upgrade(db) {
            if (!db.objectStoreNames.contains(媒体Tus断点存储名)) {
              const store = db.createObjectStore(媒体Tus断点存储名, {
                keyPath: "urlStorageKey",
              });
              store.createIndex(媒体Tus断点Fingerprint索引名, "fingerprint", {
                unique: false,
              });
            }
          },
        }
      );
    }
    return 数据库Promise;
  };

  return {
    async findAllUploads(): Promise<媒体Tus历史上传[]> {
      const db = await 读取数据库();
      const records = await db.getAll(媒体Tus断点存储名);
      return records.map(复制媒体Tus历史上传);
    },

    async findUploadsByFingerprint(fingerprint: string): Promise<媒体Tus历史上传[]> {
      const db = await 读取数据库();
      const records = await db.getAllFromIndex(
        媒体Tus断点存储名,
        媒体Tus断点Fingerprint索引名,
        fingerprint
      );
      return records.map(复制媒体Tus历史上传);
    },

    async removeUpload(urlStorageKey: string): Promise<void> {
      const db = await 读取数据库();
      await db.delete(媒体Tus断点存储名, urlStorageKey);
    },

    async addUpload(
      fingerprint: string,
      upload: 待保存媒体Tus历史上传
    ): Promise<string> {
      const urlStorageKey = 生成媒体Tus断点键(fingerprint);
      const db = await 读取数据库();
      await db.put(
        媒体Tus断点存储名,
        规范化媒体Tus断点记录(fingerprint, urlStorageKey, upload)
      );
      return urlStorageKey;
    },
  };
};

export const 创建媒体Tus断点UrlStorage = (): 媒体Tus断点UrlStorage => {
  const memory = 创建内存媒体Tus断点存储();
  const indexedDb = 创建IndexedDB媒体Tus断点存储();
  if (!indexedDb) {
    return memory;
  }
  /**
   * Tus 官方默认 WebStorageUrlStorage 直接写 localStorage；localStorage 满了会把上传主链打断。
   * 这里把持久断点交给 IndexedDB，并用内存存储兜住 IDB 异常，保证“断点恢复失败”不会升级成“上传失败”。
   */
  return {
    async findAllUploads(): Promise<媒体Tus历史上传[]> {
      const memoryUploads = await memory.findAllUploads();
      try {
        return [...(await indexedDb.findAllUploads()), ...memoryUploads];
      } catch {
        return memoryUploads;
      }
    },

    async findUploadsByFingerprint(fingerprint: string): Promise<媒体Tus历史上传[]> {
      const memoryUploads = await memory.findUploadsByFingerprint(fingerprint);
      try {
        return [...(await indexedDb.findUploadsByFingerprint(fingerprint)), ...memoryUploads];
      } catch {
        return memoryUploads;
      }
    },

    async removeUpload(urlStorageKey: string): Promise<void> {
      try {
        await indexedDb.removeUpload(urlStorageKey);
      } catch {
        // 持久层删除失败不应阻断内存兜底清理。
      }
      await memory.removeUpload(urlStorageKey);
    },

    async addUpload(
      fingerprint: string,
      upload: 待保存媒体Tus历史上传
    ): Promise<string> {
      try {
        return await indexedDb.addUpload(fingerprint, upload);
      } catch {
        return memory.addUpload(fingerprint, upload);
      }
    },
  };
};
