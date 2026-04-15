import path from 'path';
import { readdir, readFile, writeFile, mkdir,  } from 'fs/promises';

const TEMPLATE_EXTENSION = '.template.html';

const srcDir = './src';
const outputDir = './public';
const BASE_TEMPLATE_FILE = 'base.template.html';

const BLOG_LATEST_TAG = '<b style="color: darkblue">👈 Última actualización</b>';

const pageFiles = (await readdir(
    path.join(srcDir, 'pages'), {
        recursive: true
    }
)).filter(x => x.endsWith(TEMPLATE_EXTENSION));

pageFiles.sort((a, b) => b.split('/').length - a.split('/').length);

const pages = pageFiles.map(x => {
    return {
        file: x,
        level: x.split('/').length - 1,
    }
});

let baseLayout;

async function getBaseLayout() {
    if (!baseLayout) {
        baseLayout = await readFile(path.join(srcDir, BASE_TEMPLATE_FILE), 'utf-8');
    }

    return baseLayout;
}

function formatDate(date) {
    return [
        (date.getDate() + 1 + '').padStart(2, '0'),
        (date.getMonth() + 1 + '').padStart(2, '0'),
        date.getFullYear(),
    ].join('/');
}

function generateRssFeed(posts) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
        <channel>
        <title>Your Site Name</title>
    <link>https://yoursite.com</link>
    <description>Your updates</description>

    ${posts.map(post => `
    <item>
      <title>${post.title}</title>
      <link>https://yoursite.com${post.url}</link>
      <description>${post.description}</description>
      <pubDate>${post.date}</pubDate>
      <guid>https://yoursite.com${post.url}</guid>
    </item>
    `).join("")}

</channel>
</rss>`;
}

let blogPosts = [];

for (const page of pages) {
    const { file, level } = page;
    console.log(`Processing ${file}...`);

    const content = await readFile(path.join(srcDir, 'pages', file), 'utf-8');
    const lines = content.split('\n');

    // If we're extending from the base layout, use it for the rest of the process
    const matches = lines[0].match(/(@base)( \w+)?/);
    const isBase = undefined !== matches[1];
    const tag = matches[2]?.trim();

    const templateOutput = isBase ?
        (await getBaseLayout()).split('\n') :
        lines
    ;

    // *** process @yield, find indexes and reverse sort so we can splice later ***
    const yields = [];
    templateOutput.forEach(
        (x, index) => {
            if (!x.trim().startsWith('@yield')) {
                return;
            }

            yields.push({
                index,
                name: x.trim().slice(7),
            });
        }
    );

    yields.sort((a, b) => b.index - a.index);

    // Find sections in target page and replace with content from @section matching the @yield tag
    for (const yieldLine of yields) {
        const yieldContentStartIdx = lines.findIndex(x => x === `@section ${yieldLine.name}`);
        const yieldContentEndIdx = lines.findIndex((x, idx) => x === `@end` && idx > yieldContentStartIdx);

        templateOutput.splice(
            yieldLine.index, 1, ...lines.slice(yieldContentStartIdx + 1, yieldContentEndIdx)
        );
    }

    // *** process @include, find indexes and reverse sort so we can splice later ***
    const includeDirectives = [];
    templateOutput.forEach(
        (x, index) => {
            if (!x.trim().startsWith('@include')) {
                return;
            }

            includeDirectives.push({
                index,
                name: x.trim().slice(9),
            });
        }
    );

    includeDirectives.sort((a, b) => b.index - a.index)

    // Splice them lines!
    for (const includeDirective of includeDirectives) {
        const includeContent = (await readFile(path.join(srcDir, `${includeDirective.name}`), 'utf-8'))
            .split('\n');

        templateOutput.splice(includeDirective.index, 1, ...includeContent);
    }

    // *** Nav link processing, this one I like! ***
    let activePageLinkIndex = 0;
    const targetPageURI = file.replace(TEMPLATE_EXTENSION, '.html');

    for (let i = 0; i < templateOutput.length; ++i) {
        if (templateOutput[i].trim().startsWith(`<li><a href="@rel(${targetPageURI})"`)) {
            activePageLinkIndex = i;
            break;
        }
    }

    if (activePageLinkIndex) {
        const elSpan = templateOutput[activePageLinkIndex]
            .replace(`<a href="@rel(${targetPageURI})">`, '<span>')
            .replace('</a>', '</span>');

        templateOutput.splice(activePageLinkIndex, 1, elSpan);
    }

    // Some more border cases
    switch (tag) {
        case 'blog':
            // Add blog.css
            const mainCssIndex = templateOutput.findIndex(x => x.includes('main.css'));
            templateOutput.splice(mainCssIndex, 0, templateOutput[mainCssIndex].replace('main.css', 'blog.css'));

            // Add to blog posts for index and RSS feed
            const titleIndex = templateOutput.findIndex(x => x.includes('<h2>'));
            const titleLine = templateOutput[titleIndex];

            if (titleIndex !== -1) {
                blogPosts.push({
                    title: titleLine.replace('<h2>', '').replace('</h2>', '').trim(),
                    url: targetPageURI,
                    date: new Date(
                        targetPageURI.substring('blog/'.length, 'blog/'.length + 10)
                    ),
                });
            }

            break;

        default:
            break;
    }

    // Final pass for @rel
    for (let i = 0; i < templateOutput.length; ++i) {
        const matches = templateOutput[i].match(/(@rel\(([^)]+)\))/);
        if (!matches) continue;

        const line = templateOutput[i].replace(matches[1], '../'.repeat(level) + matches[2]);
        templateOutput.splice(i, 1, line);
    }

    // Final final pass for blog only
    if (targetPageURI === 'blog.html') {
        const i = templateOutput.findIndex(x => x.includes('<tbody></tbody>'));
        const rows = blogPosts.map((post, i) => `
<tr>
  <td>
    ${formatDate(post.date)}
    ${i === 0 ? BLOG_LATEST_TAG : ''}
  </td>
  <td>
    <a href="${post.url}">${post.title}</a>
  </td>
</tr>`)
        templateOutput.splice(i, 1, rows.join('\n'));
    }

    // Write to file, be happy
    try {
        await mkdir(path.dirname(path.join(outputDir, targetPageURI)));
    } catch { /* ignore */ }

    await writeFile(path.join(outputDir, targetPageURI), templateOutput.join('\n'), {
        encoding: 'utf-8',
    });
    console.log(` > Wrote to ${targetPageURI}!\n`)
}
