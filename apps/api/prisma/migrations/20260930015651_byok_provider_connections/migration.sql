-- CreateTable
CREATE TABLE "provider_connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "baseUrl" TEXT,
    "api" TEXT,
    "credentialsRef" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_model" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "upstreamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hint" TEXT,
    "description" TEXT,
    "iconSvg" TEXT NOT NULL DEFAULT '',
    "outputType" TEXT NOT NULL DEFAULT 'text',
    "contextWindowTokens" INTEGER,
    "maxInputTokens" INTEGER,
    "maxOutputTokens" INTEGER,
    "reasoningEfforts" TEXT[],
    "capabilities" JSONB,
    "imageCapabilities" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_role_assignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "catalogModelId" TEXT,
    "providerModelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_connection_userId_idx" ON "provider_connection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_connection_userId_slug_key" ON "provider_connection"("userId", "slug");

-- CreateIndex
CREATE INDEX "provider_model_userId_idx" ON "provider_model"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_model_userId_slug_key" ON "provider_model"("userId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "provider_model_connectionId_upstreamId_key" ON "provider_model"("connectionId", "upstreamId");

-- CreateIndex
CREATE UNIQUE INDEX "model_role_assignment_userId_role_key" ON "model_role_assignment"("userId", "role");

-- AddForeignKey
ALTER TABLE "provider_connection" ADD CONSTRAINT "provider_connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_model" ADD CONSTRAINT "provider_model_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_model" ADD CONSTRAINT "provider_model_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "provider_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_role_assignment" ADD CONSTRAINT "model_role_assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_role_assignment" ADD CONSTRAINT "model_role_assignment_providerModelId_fkey" FOREIGN KEY ("providerModelId") REFERENCES "provider_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
