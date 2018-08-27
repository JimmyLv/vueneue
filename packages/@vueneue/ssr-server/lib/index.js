const { readFileSync, existsSync } = require('fs-extra');
const { join } = require('path');
const Koa = require('koa');
const mount = require('koa-mount');
const serve = require('koa-static');

const createRenderer = require('./createRenderer');
const renderRoute = require('./renderRoute');

module.exports = async opts => {
  const { dist, host, port, ssr } = opts;

  const app = new Koa();
  const isProduction = process.env.NODE_ENV === 'production';
  const serverContext = { ...opts, app };

  // Vue renderer base options
  const rendererOptions = {
    directives: ssr ? ssr.directives : undefined,
    shouldPreload: ssr ? ssr.shouldPreload : undefined,
    shouldPrefetch: ssr ? ssr.shouldPrefetch : undefined,
  };

  let readyPromise;

  if (isProduction) {
    // Production

    const serverBundle = require(join(dist, 'server-bundle.json'));
    const clientManifest = require(join(dist, 'client-manifest.json'));
    serverContext.clientManifest = clientManifest;
    serverContext.renderer = createRenderer(serverBundle, {
      ...rendererOptions,
      clientManifest,
      directives: ssr ? ssr.directives : undefined,
    });

    readyPromise = Promise.resolve();
  } else {
    // Development mode

    readyPromise = require('./devMiddleware')(
      serverContext,
      (bundle, { clientManifest }) => {
        serverContext.clientManifest = clientManifest;
        serverContext.renderer = createRenderer(bundle, {
          ...rendererOptions,
          clientManifest,
        });
      },
    );
  }

  await readyPromise;

  // Server customization
  if (ssr && typeof ssr.server === 'function') {
    ssr.server(app);
  }

  // In production mode
  if (isProduction) {
    // Use index.ssr.html file for routes templates
    serverContext.template = readFileSync(
      join(dist, 'index.ssr.html'),
      'utf-8',
    );

    if (existsSync(join(dist, 'index.spa.html'))) {
      serverContext.templateSpa = readFileSync(
        join(dist, 'index.spa.html'),
        'utf-8',
      );
    }

    // Serve static files
    app.use(mount('/', serve(dist)));
  }

  // Main middleware: render routes
  app.use(ctx => {
    const { url } = ctx;
    const ssrContext = { url, ctx };

    serverContext.ctx = ctx;

    if (isProduction) {
      return renderRoute(serverContext, ssrContext);
    } else {
      return readyPromise.then(() => renderRoute(serverContext, ssrContext));
    }
  });

  let httpServer;

  const { https } = ssr || {};
  if (https && https.key && https.cert) {
    httpServer = require('https').createServer(https, app.callback());
  } else {
    httpServer = require('http').createServer(app.callback());
  }

  httpServer.listen(port, host);

  app.httpServer = httpServer;

  return httpServer;
};
