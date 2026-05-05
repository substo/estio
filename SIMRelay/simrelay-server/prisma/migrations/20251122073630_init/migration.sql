-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agency_id" TEXT NOT NULL,
    "sub_account_id" TEXT,
    "ghl_installation_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "token_expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installation_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "device_push_token" TEXT,
    "paired" BOOLEAN NOT NULL DEFAULT false,
    "pair_token_hash" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'ios',
    "phone_number" TEXT,
    "last_seen_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LocationDeviceBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installation_id" TEXT NOT NULL,
    "sub_account_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "LocationDeviceBinding_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "Installation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LocationDeviceBinding_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installation_id" TEXT NOT NULL,
    "sub_account_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "hl_message_id" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "from_number" TEXT,
    "to_number" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error_message" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "Message_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "Installation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Message_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Installation_ghl_installation_id_key" ON "Installation"("ghl_installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "LocationDeviceBinding_sub_account_id_device_id_key" ON "LocationDeviceBinding"("sub_account_id", "device_id");
