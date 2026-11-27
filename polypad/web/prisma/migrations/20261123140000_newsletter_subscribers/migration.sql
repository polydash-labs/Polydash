-- Newsletter subscribers (Nov 23, 2026): Explore page subscribe card collects
-- emails for weekly updates / announcements. NOTE: this DB has no
-- _prisma_migrations table (schema was built with db push / raw DDL), so this
-- migration file is documentary — the table was applied with
-- scripts/apply-neon-ddl.mjs (Neon serverless HTTPS driver), which is the
-- supported path from this VM because direct Postgres TLS is blocked by egress.
CREATE TABLE "NewsletterSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'explore',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribedAt" TIMESTAMPTZ(3),
    CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");
CREATE INDEX "NewsletterSubscriber_createdAt_idx" ON "NewsletterSubscriber"("createdAt");
