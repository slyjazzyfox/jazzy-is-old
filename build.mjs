import path from 'path';
import { readdir, readFile, writeFile, mkdir, rm, cp } from 'fs/promises';

const TEMPLATE_EXTENSION = '.template.html';

const rssBaseSite = 'https://jazzyhamster.ar';

const srcDir = './src';
const outputDir = './public';
const BASE_TEMPLATE_FILE = 'base.template.html';

const pageFiles = (await readdir(
    path.join(srcDir, 'pages')
)).filter(x => x.endsWith(TEMPLATE_EXTENSION));

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
        <title>Jazzy is old - blog</title>
    <link>${rssBaseSite}</link>

    ${posts.map(post => `
    <item>
      <title>${post.title}</title>
      <link>${rssBaseSite}/${post.url}</link>
      <pubDate>${post.date.toUTCString()}</pubDate>
      <guid>${rssBaseSite}/${post.url}</guid>
    </item>
    `).join("")}

</channel>
</rss>`;
}

try {
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(path.join(outputDir));
    await cp(path.join(srcDir, 'static'), outputDir, { recursive: true });
} catch { /* 🤷 */ }

let blogPosts = [];

for (const page of pages) {
    const { file } = page;
    console.log(`Processing ${file}...`);

    const content = await readFile(path.join(srcDir, 'pages', file), 'utf-8');
    const lines = content.split('\n');

    // If we're extending from the base layout, use it for the rest of the process
    const isBase = null !== lines[0].match(/@base/);

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
        if (templateOutput[i].trim().startsWith(`<a href="@rel(${targetPageURI.split('/')[0]})">`)) {
            activePageLinkIndex = i;
            break;
        }
    }

    if (activePageLinkIndex) {
        console.log('index', activePageLinkIndex);
        const elSpan = templateOutput[activePageLinkIndex]
            .replace(/(<a href="[^"]+")>/, (match, p1) => `${p1} class="active">`);

        templateOutput.splice(activePageLinkIndex, 1, elSpan);
    }

    // Final pass for @rel
    for (let i = 0; i < templateOutput.length; ++i) {
        const matches = templateOutput[i].match(/(@rel\(([^)]+)\))/);
        if (!matches) continue;

        const line = templateOutput[i].replace(matches[1], matches[2]);
        templateOutput.splice(i, 1, line);
    }

    // Final final pass for blog only
    if (targetPageURI === 'blog.html') {
        for (let i = 0; i < templateOutput.length; ++i) {
            try {
                const articleId = templateOutput[i].match(/<article id="(.+)">/)[1];
                const newPost = {
                    date: new Date([...templateOutput[i + 2]
                            .match(/<small>([^<]+)<\/small>/)[1]
                            .match(/(\d+)\/(\d+)\/(\d+)/)
                        ].slice(1)
                        .reverse()
                        .join('/')
                    ),
                    title: templateOutput[i + 3].match(/<h\d>([^<]+)<\/h\d>/)[1],
                    url: `blog.html#${articleId}`
                }

                blogPosts.push(newPost);

            } catch { }
        }
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

await writeFile(path.join(outputDir, 'blog.xml'), generateRssFeed(blogPosts), {
    encoding: 'utf-8',
});
