import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

// The handle belongs to this Host only. A forced Host exit closes it and kills
// pnpm/build descendants, including when the bridge itself has crashed.
export async function containWindowsChildren(install) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 is required');
  const { default: koffi } = await import(pathToFileURL(join(install, 'resources/app.asar/dsh/node_modules/koffi/index.js')).href);
  const kernel = koffi.load('kernel32.dll');
  const create = kernel.func('void * __stdcall CreateJobObjectW(void * attributes, str16 name)');
  const set = kernel.func('int __stdcall SetInformationJobObject(void * job, int kind, void * info, uint32_t length)');
  const assign = kernel.func('int __stdcall AssignProcessToJobObject(void * job, void * process)');
  const current = kernel.func('void * __stdcall GetCurrentProcess()');
  const job = create(null, null);
  const info = Buffer.alloc(144); // JOBOBJECT_EXTENDED_LIMIT_INFORMATION, Windows x64
  info.writeUInt32LE(0x2000, 16); // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
  if (!job || !set(job, 9, info, info.length) || !assign(job, current())) throw new Error('Cannot contain DSH child processes');
  return { job, kernel }; // keep the native library and owned handle alive
}
