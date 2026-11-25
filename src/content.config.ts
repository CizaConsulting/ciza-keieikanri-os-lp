import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    keywords: z.array(z.string()).default([]),
    date: z.coerce.date(),
    // タイトル・説明文などを改訂した日。JSON-LD の dateModified に使う
    updated: z.coerce.date().optional(),
    author: z.string(),
  }),
});

export const collections = { blog };
