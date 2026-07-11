export interface ErrorBody {
  error: {
    message: string;
  };
}

export function json<T>(body: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=UTF-8');

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function success<T>(body: T, init: ResponseInit = {}): Response {
  return json(body, {
    ...init,
    status: init.status ?? 200,
  });
}

export function error(message: string, status = 500): Response {
  return json<ErrorBody>(
    {
      error: {
        message,
      },
    },
    { status },
  );
}
