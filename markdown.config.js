import { mdsvex } from 'mdsvex'

function rewriteDocumentationLinks() {
  return (tree) => {
    const headingSlugCounts = new Map()

    function getText(node) {
      if (typeof node.value === 'string') return node.value
      return (node.children ?? []).map(getText).join('')
    }

    function slugify(value) {
      const base = value
        .replace(/&/g, ' and ')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

      return base || null
    }

    function headingSlug(node) {
      const base = slugify(getText(node))
      if (!base) return null

      const count = headingSlugCounts.get(base) ?? 0
      headingSlugCounts.set(base, count + 1)
      return count === 0 ? base : `${base}-${count}`
    }

    function visit(node) {
      if (node.type === 'heading') {
        const id = headingSlug(node)
        if (id) {
          node.data = {
            ...node.data,
            hProperties: {
              ...node.data?.hProperties,
              id,
            },
          }
        }
      }

      if (
        (node.type === 'link' || node.type === 'image') &&
        typeof node.url === 'string'
      ) {
        if (node.url.startsWith('#')) {
          const slug = slugify(decodeURIComponent(node.url.slice(1)))
          if (slug) node.url = `#${slug}`
        } else if (node.url.startsWith('static/docs/screenshots/')) {
          node.url = `/${node.url.slice('static/'.length)}`
        } else if (node.url === 'docs/http-api.md') {
          node.url = '/docs/http-api'
        } else if (
          node.url === 'static/openapi.yaml' ||
          node.url === '../static/openapi.yaml'
        ) {
          node.url = '/openapi.yaml'
        } else if (node.url.startsWith('../README.md')) {
          node.url = node.url.replace('../README.md', '/docs')
        } else if (node.url.startsWith('./') || node.url.startsWith('docs/')) {
          node.url = `https://github.com/metafab/otel-gui/blob/main/${node.url.replace(/^\.?\//, '')}`
        }
      }

      if (node.type === 'html' && typeof node.value === 'string') {
        node.value = node.value.replace(
          'src="src/lib/assets/logo.svg"',
          'src="/docs/logo.svg"',
        )
        node.value = node.value.replace('href="#"', 'href="/docs"')
      }

      for (const child of node.children ?? []) {
        visit(child)
      }
    }

    visit(tree)
  }
}

export function markdownOptions() {
  return {
    extensions: ['.svelte', '.md'],
    preprocess: mdsvex({
      extensions: ['.md'],
      remarkPlugins: [rewriteDocumentationLinks],
    }),
  }
}
