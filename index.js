import chalk from 'chalk';
import { promptConfig, promptConfirm } from './src/cli/prompts.js';
import { scanPhotos } from './src/utils/helpers.js';
import { processPhoto } from './src/process/watermark.js';
import path from 'path';
import fs from 'fs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Entry point — orkestrasi seluruh alur dari konfigurasi hingga output foto. */
async function main() {
  try {
    console.log(chalk.cyan.bold('\n=== Watermark Foto — GPS Overlay Tool ===\n'));

    // Step 1: Konfigurasi
    console.log(chalk.yellow('Step 1: Konfigurasi'));
    const cfg = await promptConfig();

    const inputDir  = path.resolve(cfg.input);
    const outputDir = path.resolve(cfg.output);

    // Step 2: Scan foto
    console.log(chalk.yellow('\nStep 2: Scan Foto'));
    const files = scanPhotos(inputDir);

    if (files.length === 0) {
      console.log(chalk.red('✗ Tidak ada file JPEG ditemukan di folder tersebut.'));
      process.exit(0);
    }

    console.log(chalk.green(`✓ Ditemukan ${files.length} foto:`));
    files.forEach(f => console.log(chalk.gray(`  - ${f}`)));

    // Step 3: Konfirmasi
    console.log('');
    const confirmed = await promptConfirm(files.length);
    if (!confirmed) {
      console.log(chalk.gray('\nDibatalkan.'));
      process.exit(0);
    }

    // Step 4: Proses foto
    console.log(chalk.yellow('\nStep 3: Memproses Foto'));
    fs.mkdirSync(outputDir, { recursive: true });

    for (let i = 0; i < files.length; i++) {
      const file      = files[i];
      const inputPath = path.join(inputDir, file);
      const outPath   = path.join(outputDir, file);

      process.stdout.write(`[${i + 1}/${files.length}] ${chalk.white(file)} ... `);

      try {
        await processPhoto(inputPath, outPath, cfg);
        console.log(chalk.green('✓ selesai'));
      } catch (err) {
        console.log(chalk.red(`✗ SKIP (${err.message})`));
      }

      // Nominatim rate-limit: 1 req/detik
      if (i < files.length - 1) await sleep(1100);
    }

    console.log(chalk.green.bold(`\n✓ Selesai! Hasil disimpan di: ${outputDir}`));

  } catch (error) {
    console.error(chalk.red.bold('\n✗ Error:'), error.message);
    process.exit(1);
  }
}

main();
