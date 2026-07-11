# Database

The MVP deliberately does not persist chat history or session state. Durable Object state is in memory only; KV stores configuration JSON and R2 stores image objects. D1 is reserved for a future persistence phase.
