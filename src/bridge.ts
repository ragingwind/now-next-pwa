import { AddressInfo } from 'net';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import {
  Server,
  IncomingHttpHeaders,
  OutgoingHttpHeaders,
  request,
} from 'http';

interface NowProxyEvent {
  Action: string;
  body: string;
}

export interface NowProxyRequest {
  isApiGateway?: boolean;
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface NowProxyResponse {
  statusCode: number;
  headers: OutgoingHttpHeaders;
  body: string;
  encoding: string;
}

interface ServerLike {
  listen: (
    opts: {
      host?: string;
      port?: number;
    },
    callback: (this: Server | null) => void
  ) => Server | void;
}

/**
 * If the `http.Server` handler function throws an error asynchronously,
 * then it ends up being an unhandled rejection which doesn't kill the node
 * process which causes the HTTP request to hang indefinitely. So print the
 * error here and force the process to exit so that the lambda invocation
 * returns an Unhandled error quickly.
 */
process.on('unhandledRejection', err => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});

function normalizeNowProxyEvent(event: NowProxyEvent): NowProxyRequest {
  let bodyBuffer: Buffer | null;
  const { method, path, headers, encoding, body } = JSON.parse(event.body);

  if (body) {
    if (encoding === 'base64') {
      bodyBuffer = Buffer.from(body, encoding);
    } else if (encoding === undefined) {
      bodyBuffer = Buffer.from(body);
    } else {
      throw new Error(`Unsupported encoding: ${encoding}`);
    }
  } else {
    bodyBuffer = Buffer.alloc(0);
  }

  return { isApiGateway: false, method, path, headers, body: bodyBuffer };
}

function normalizeAPIGatewayProxyEvent(
  event: APIGatewayProxyEvent
): NowProxyRequest {
  let bodyBuffer: Buffer | null;
  const { httpMethod: method, path, headers, body } = event;

  if (body) {
    if (event.isBase64Encoded) {
      bodyBuffer = Buffer.from(body, 'base64');
    } else {
      bodyBuffer = Buffer.from(body);
    }
  } else {
    bodyBuffer = Buffer.alloc(0);
  }

  return { isApiGateway: true, method, path, headers, body: bodyBuffer };
}

function normalizeEvent(
  event: NowProxyEvent | APIGatewayProxyEvent
): NowProxyRequest {
  if ('Action' in event) {
    if (event.Action === 'Invoke') {
      return normalizeNowProxyEvent(event);
    } else {
      throw new Error(`Unexpected event.Action: ${event.Action}`);
    }
  } else {
    return normalizeAPIGatewayProxyEvent(event);
  }
}

export class Bridge {
  private server: ServerLike | null;
  private listening: Promise<AddressInfo>;
  private resolveListening: (info: AddressInfo) => void;
  private events: { [key: string]: NowProxyRequest } = {};
  private reqIdSeed: number = 1;
  private shouldStoreEvents: boolean = false;

  constructor(server?: ServerLike, shouldStoreEvents: boolean = false) {
    this.server = null;
    this.shouldStoreEvents = shouldStoreEvents;
    if (server) {
      this.setServer(server);
    }
    this.launcher = this.launcher.bind(this);

    // This is just to appease TypeScript strict mode, since it doesn't
    // understand that the Promise constructor is synchronous
    this.resolveListening = (info: AddressInfo) => {};

    this.listening = new Promise(resolve => {
      this.resolveListening = resolve;
    });
  }

  setServer(server: ServerLike) {
    this.server = server;
  }

  listen() {
    if (!this.server) {
      throw new Error('Server has not been set!');
    }

    const resolveListening = this.resolveListening;

    return this.server.listen(
      {
        host: '127.0.0.1',
        port: 0,
      },
      function listeningCallback() {
        if (!this || typeof this.address !== 'function') {
          throw new Error(
            'Missing server.address() function on `this` in server.listen()'
          );
        }

        const addr = this.address();

        if (!addr) {
          throw new Error('`server.address()` returned `null`');
        }

        if (typeof addr === 'string') {
          throw new Error(
            `Unexpected string for \`server.address()\`: ${addr}`
          );
        }

        resolveListening(addr);
      }
    );
  }

  async launcher(
    event: NowProxyEvent | APIGatewayProxyEvent,
    context: Context
  ): Promise<NowProxyResponse> {
    context.callbackWaitsForEmptyEventLoop = false;
    const { port } = await this.listening;

    const normalizedEvent = normalizeEvent(event);
    const { isApiGateway, method, path, headers, body } = normalizedEvent;

    if (this.shouldStoreEvents) {
      const reqId = `${this.reqIdSeed++}`;
      this.events[reqId] = normalizedEvent;
      headers['x-now-bridge-request-id'] = reqId;
    }

    const opts = { hostname: '127.0.0.1', port, path, method, headers };

    // eslint-disable-next-line consistent-return
    return new Promise((resolve, reject) => {
      const req = request(opts, res => {
        const response = res;
        const respBodyChunks: Buffer[] = [];
        response.on('data', chunk => respBodyChunks.push(Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () => {
          const bodyBuffer = Buffer.concat(respBodyChunks);
          delete response.headers.connection;

          if (isApiGateway) {
            delete response.headers['content-length'];
          } else if (response.headers['content-length']) {
            response.headers['content-length'] = String(bodyBuffer.length);
          }

          resolve({
            statusCode: response.statusCode || 200,
            headers: response.headers,
            body: bodyBuffer.toString('base64'),
            encoding: 'base64',
          });
        });
      });

      req.on('error', error => {
        setTimeout(() => {
          // this lets express print the true error of why the connection was closed.
          // it is probably 'Cannot set headers after they are sent to the client'
          reject(error);
        }, 2);
      });

      if (body) req.write(body);
      req.end();
    });
  }

  consumeEvent(reqId: string) {
    const event = this.events[reqId];
    delete this.events[reqId];
    return event;
  }
}
