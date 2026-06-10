import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';

export async function promptConfig() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'input',
      message: 'Folder foto sumber:',
      default: '../sources',
      validate: (val) => {
        if (!fs.existsSync(path.resolve(val))) return `Folder tidak ditemukan: ${path.resolve(val)}`;
        return true;
      }
    },
    {
      type: 'input',
      name: 'output',
      message: 'Folder output:',
      default: '../hasil'
    },
    {
      type: 'number',
      name: 'panel',
      message: 'Tinggi panel bawah (% dari tinggi foto, 10-50):',
      default: 28,
      validate: (val) => {
        if (val < 10 || val > 50) return 'Masukkan nilai antara 10-50';
        return true;
      }
    },
    {
      type: 'number',
      name: 'zoom',
      message: 'Zoom level peta OSM (14 = luas, 17 = detail):',
      default: 15,
      validate: (val) => {
        if (val < 1 || val > 19) return 'Masukkan nilai antara 1-19';
        return true;
      }
    },
    {
      type: 'list',
      name: 'lang',
      message: 'Bahasa nama hari:',
      choices: [
        { name: 'Indonesia  (Senin, Selasa, ...)', value: 'id' },
        { name: 'English    (Monday, Tuesday, ...)', value: 'en' }
      ],
      default: 'id'
    }
  ]);

  return answers;
}

export async function promptConfirm(total) {
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `Proses ${total} foto sekarang?`,
      default: true
    }
  ]);
  return confirmed;
}
