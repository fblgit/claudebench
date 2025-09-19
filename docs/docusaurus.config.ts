import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'ClaudeBench',
  tagline: 'Redis-first event-driven AI workbench',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://claudebench.dev',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'fblgit', // Usually your GitHub org/user name.
  projectName: 'claudebench', // Usually your repo name.

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/fblgit/claudebench/tree/main/docs/',
          showLastUpdateTime: true,
          showLastUpdateAuthor: true,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  
  markdown: {
    mermaid: true,
  },
  themes: ['@docusaurus/theme-mermaid'],

  plugins: [
    ['./plugins/docusaurus-plugin-json-api', {
      docsDir: './docs',
      apiPath: '/api/docs',
      includeContent: true,
    }],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/claudebench-social-card.jpg',
    mermaid: {
      theme: {light: 'default', dark: 'dark'},
    },
    navbar: {
      title: 'ClaudeBench',
      logo: {
        alt: 'ClaudeBench Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {to: 'api', label: 'API', position: 'left'},
        {to: 'handlers', label: 'Handlers', position: 'left'},
        {
          href: 'https://github.com/fblgit/claudebench',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/intro',
            },
            {
              label: 'Architecture',
              to: '/architecture',
            },
            {
              label: 'API Reference',
              to: '/api',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/fblgit/claudebench',
            },
            {
              label: 'Issues',
              href: 'https://github.com/fblgit/claudebench/issues',
            },
            {
              label: 'Discussions',
              href: 'https://github.com/fblgit/claudebench/discussions',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Contributing',
              to: '/contributing',
            },
            {
              label: 'License',
              to: '/license',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} ClaudeBench Contributors. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
