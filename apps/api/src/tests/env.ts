if (!process.env.DATABASE_URL?.includes("marketplace_test")) {
  throw new Error(`Refusing to run tests against ${process.env.DATABASE_URL}`);
}
