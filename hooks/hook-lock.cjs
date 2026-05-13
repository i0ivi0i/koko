const fs = require('fs');
const path = require('path');

const HOOK_LOCK_SUBDIR = '.hook-locks';
const HOOK_LOCK_MAX_INFLIGHT = 3;
const HOOK_LOCK_STALE_MS = 30000;

function acquireHookSlot(gitNexusDir) {
  const lockDir = path.join(gitNexusDir, HOOK_LOCK_SUBDIR);
  try {
    fs.mkdirSync(lockDir, { recursive: true });
  } catch {
    return null;
  }

  const myPidStr = String(process.pid);

  for (let slot = 0; slot < HOOK_LOCK_MAX_INFLIGHT; slot++) {
    const slotPath = path.join(lockDir, `slot-${slot}.lock`);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(slotPath, myPidStr, { flag: 'wx' });
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          try {
            const content = fs.readFileSync(slotPath, 'utf-8').trim();
            if (content === myPidStr) fs.unlinkSync(slotPath);
          } catch {
            /* already removed or unreadable */
          }
        };
        process.on('exit', release);
        return release;
      } catch {
        let fd;
        try {
          fd = fs.openSync(slotPath, 'r');
        } catch {
          continue;
        }
        let isLive = false;
        let mtimeMs = Date.now();
        try {
          mtimeMs = fs.fstatSync(fd).mtimeMs;
          const buf = Buffer.alloc(32);
          const n = fs.readSync(fd, buf, 0, 32, 0);
          const ownerStr = buf.slice(0, n).toString('utf-8').trim();
          if (ownerStr === '') {
            isLive = true;
          } else {
            const owner = Number.parseInt(ownerStr, 10);
            if (Number.isFinite(owner) && owner > 0) {
              try {
                process.kill(owner, 0);
                isLive = true;
              } catch (e) {
                if (e && e.code === 'ESRCH') {
                  isLive = false;
                } else {
                  isLive = true;
                }
              }
            }
          }
        } catch {
          /* unreadable — treat as dead */
        } finally {
          try {
            fs.closeSync(fd);
          } catch {
            /* already closed */
          }
        }
        if (isLive && Date.now() - mtimeMs > HOOK_LOCK_STALE_MS) {
          isLive = false;
        }
        if (isLive) break;
        try {
          fs.unlinkSync(slotPath);
        } catch {
          /* another hook beat us to it */
        }
      }
    }
  }

  return null;
}

module.exports = {
  HOOK_LOCK_SUBDIR,
  HOOK_LOCK_MAX_INFLIGHT,
  HOOK_LOCK_STALE_MS,
  acquireHookSlot,
};
