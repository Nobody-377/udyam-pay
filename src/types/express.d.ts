declare module 'express' {
  export interface Request {
    headers: Record<string, string | string[] | undefined>;
    body: any;
    params: Record<string, string>;
    query: Record<string, string | string[] | undefined>;
    url?: string;
    method?: string;
    user?: any;
    id?: string;
  }

  export interface Response {
    status(code: number): Response;
    json(body: any): Response;
    send(body: any): Response;
    setHeader(name: string, value: string | number): Response;
    set(name: string, value: string): Response;
    headersSent: boolean;
  }

  export type NextFunction = (err?: any) => void;
  export type RequestHandler = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
  export type ErrorRequestHandler = (err: any, req: Request, res: Response, next: NextFunction) => void | Promise<void>;

  export interface Router {
    use(...handlers: any[]): Router;
    get(path: string, ...handlers: any[]): Router;
    post(path: string, ...handlers: any[]): Router;
    put(path: string, ...handlers: any[]): Router;
    patch(path: string, ...handlers: any[]): Router;
    delete(path: string, ...handlers: any[]): Router;
    options(path: string, ...handlers: any[]): Router;
  }

  export interface Express extends Router {
    disable(setting: string): Express;
    set(setting: string, val: any): Express;
    listen(port: number, cb?: () => void): any;
  }

  export function Router(): Router;
  function express(): Express;
  namespace express {
    export function json(options?: any): RequestHandler;
  }
  export default express;
}
