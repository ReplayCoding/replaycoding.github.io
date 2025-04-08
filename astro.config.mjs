// @ts-check
import { defineConfig } from 'astro/config';
import fs from 'node:fs';

let highlightLangs = [
    'armasm',
    'smali'
];

// https://astro.build/config
export default defineConfig({
    build: {
        inlineStylesheets: 'always',
    },
    markdown: {
        shikiConfig: {
            theme: 'github-light',
            langs: highlightLangs.map(lang => {
                let content = fs.readFileSync(`src/highlight/${lang}.json`, 'utf-8');
                return JSON.parse(content);
            }),
        }
    }
});
