import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

await writeFile(new URL('../dist/build-info.json', import.meta.url), JSON.stringify({ buildId: `gateway-${randomUUID()}` }) + '\n');
