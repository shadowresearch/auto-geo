<script>
  const endpoints = {
    publish: "POST /api/resources/publish",
    delete: "DELETE /api/resources/publish?slug=<slug>",
    list: "GET /api/resources",
    get: "GET /api/resources/[slug]",
  };
</script>

<h1>auto-geo SvelteKit example</h1>
<p>
  Endpoint-only example. See the
  <a href="https://github.com/shadowresearch/auto-geo">repo README</a>
  for the curl payload.
</p>
<ul>
  {#each Object.entries(endpoints) as [name, route] (name)}
    <li><strong>{name}</strong>: <code>{route}</code></li>
  {/each}
</ul>
