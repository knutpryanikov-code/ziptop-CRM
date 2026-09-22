import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({ base: process.env.CRM_BASE || '/', integrations: [tailwind()] });
