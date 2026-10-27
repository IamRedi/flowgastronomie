-- CreateTable
CREATE TABLE "WorkforceAccountPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforceAccountPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceMonthlyClose" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceHash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "frozenContext" JSONB NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "auditEventId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceMonthlyClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceMonthlyAdjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "closeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "delta" JSONB NOT NULL,
    "afterSnapshot" JSONB NOT NULL,
    "sourceReferences" JSONB NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "auditEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforceMonthlyAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceNotification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "requiredPermission" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "important" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforceNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceNotificationReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "readAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceNotificationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceNotificationPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "locale" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderMinutes" INTEGER NOT NULL DEFAULT 60,
    "categories" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceNotificationPreferenceRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preferenceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforceNotificationPreferenceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforcePushSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "endpointHash" TEXT NOT NULL,
    "subscription" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforcePushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceNotificationDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "recipientAddress" TEXT,
    "subscriptionId" TEXT,
    "lastCode" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceNotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceNotificationDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "leaseToken" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "code" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceNotificationDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkforceAccountPolicy_tenantId_venueId_countryCode_effecti_idx" ON "WorkforceAccountPolicy"("tenantId", "venueId", "countryCode", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceAccountPolicy_tenantId_venueId_id_key" ON "WorkforceAccountPolicy"("tenantId", "venueId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceAccountPolicy_venueId_countryCode_version_key" ON "WorkforceAccountPolicy"("venueId", "countryCode", "version");

-- CreateIndex
CREATE INDEX "WorkforceMonthlyClose_tenantId_venueId_month_idx" ON "WorkforceMonthlyClose"("tenantId", "venueId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceMonthlyClose_tenantId_venueId_id_key" ON "WorkforceMonthlyClose"("tenantId", "venueId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceMonthlyClose_tenantId_venueId_id_userId_key" ON "WorkforceMonthlyClose"("tenantId", "venueId", "id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceMonthlyClose_venueId_userId_month_key" ON "WorkforceMonthlyClose"("venueId", "userId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceMonthlyClose_tenantId_actorUserId_idempotencyKey_key" ON "WorkforceMonthlyClose"("tenantId", "actorUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WorkforceMonthlyAdjustment_tenantId_venueId_userId_createdA_idx" ON "WorkforceMonthlyAdjustment"("tenantId", "venueId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceMonthlyAdjustment_tenantId_venueId_id_key" ON "WorkforceMonthlyAdjustment"("tenantId", "venueId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceMonthlyAdjustment_closeId_version_key" ON "WorkforceMonthlyAdjustment"("closeId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceMonthlyAdjustment_closeId_sourceHash_key" ON "WorkforceMonthlyAdjustment"("closeId", "sourceHash");

-- CreateIndex
CREATE INDEX "WorkforceNotification_tenantId_venueId_userId_createdAt_id_idx" ON "WorkforceNotification"("tenantId", "venueId", "userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceNotification_tenantId_venueId_id_key" ON "WorkforceNotification"("tenantId", "venueId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceNotification_tenantId_venueId_id_userId_key" ON "WorkforceNotification"("tenantId", "venueId", "id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceNotification_tenantId_venueId_eventKey_userId_key" ON "WorkforceNotification"("tenantId", "venueId", "eventKey", "userId");

-- CreateIndex
CREATE INDEX "WorkforceNotificationReceipt_tenantId_venueId_userId_idx" ON "WorkforceNotificationReceipt"("tenantId", "venueId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceNotificationReceipt_notificationId_key" ON "WorkforceNotificationReceipt"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceNotificationPreference_tenantId_venueId_id_key" ON "WorkforceNotificationPreference"("tenantId", "venueId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceNotificationPreference_venueId_userId_key" ON "WorkforceNotificationPreference"("venueId", "userId");

-- CreateIndex
CREATE INDEX "WorkforceNotificationPreferenceRevision_tenantId_venueId_us_idx" ON "WorkforceNotificationPreferenceRevision"("tenantId", "venueId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceNotificationPreferenceRevision_preferenceId_versio_key" ON "WorkforceNotificationPreferenceRevision"("preferenceId", "version");

-- CreateIndex
CREATE INDEX "WorkforcePushSubscription_tenantId_venueId_userId_active_idx" ON "WorkforcePushSubscription"("tenantId", "venueId", "userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforcePushSubscription_tenantId_venueId_id_key" ON "WorkforcePushSubscription"("tenantId", "venueId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforcePushSubscription_tenantId_venueId_userId_endpointH_key" ON "WorkforcePushSubscription"("tenantId", "venueId", "userId", "endpointHash");

-- CreateIndex
CREATE INDEX "WorkforceNotificationDelivery_state_nextAttemptAt_leaseUnti_idx" ON "WorkforceNotificationDelivery"("state", "nextAttemptAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "WorkforceNotificationDelivery_tenantId_venueId_userId_idx" ON "WorkforceNotificationDelivery"("tenantId", "venueId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceNotificationDelivery_tenantId_venueId_id_key" ON "WorkforceNotificationDelivery"("tenantId", "venueId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceNotificationDelivery_notificationId_channel_key" ON "WorkforceNotificationDelivery"("notificationId", "channel");

-- CreateIndex
CREATE INDEX "WorkforceNotificationDeliveryAttempt_tenantId_venueId_userI_idx" ON "WorkforceNotificationDeliveryAttempt"("tenantId", "venueId", "userId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceNotificationDeliveryAttempt_deliveryId_attemptNumb_key" ON "WorkforceNotificationDeliveryAttempt"("deliveryId", "attemptNumber");


-- New scope keys do not modify any pre-existing record.
CREATE UNIQUE INDEX wf3_membership_scope_user ON "Membership"("tenantId","venueId",id,"userId");
CREATE UNIQUE INDEX wf3_audit_scope ON "AuditEvent"("tenantId","venueId",id);
CREATE UNIQUE INDEX wf3_preference_scope_user ON "WorkforceNotificationPreference"("tenantId","venueId",id,"userId");
CREATE UNIQUE INDEX wf3_delivery_scope_user ON "WorkforceNotificationDelivery"("tenantId","venueId",id,"userId");
ALTER TABLE "WorkforceAccountPolicy" ADD CONSTRAINT "WorkforceAccountPolicy_venue" FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceAccountPolicy" ADD CONSTRAINT "WorkforceAccountPolicy_actor" FOREIGN KEY ("tenantId","createdByUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
CREATE TRIGGER "WorkforceAccountPolicy_immutable" BEFORE UPDATE OR DELETE ON "WorkforceAccountPolicy" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
ALTER TABLE "WorkforceMonthlyClose" ADD CONSTRAINT "WorkforceMonthlyClose_venue" FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceMonthlyClose" ADD CONSTRAINT "WorkforceMonthlyClose_subject" FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceMonthlyClose" ADD CONSTRAINT "WorkforceMonthlyClose_member" FOREIGN KEY ("tenantId","venueId","membershipId","userId") REFERENCES "Membership"("tenantId","venueId",id,"userId") ON DELETE RESTRICT;
ALTER TABLE "WorkforceMonthlyClose" ADD CONSTRAINT "WorkforceMonthlyClose_actor" FOREIGN KEY ("tenantId","actorUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
CREATE TRIGGER "WorkforceMonthlyClose_immutable" BEFORE UPDATE OR DELETE ON "WorkforceMonthlyClose" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
ALTER TABLE "WorkforceMonthlyAdjustment" ADD CONSTRAINT "WorkforceMonthlyAdjustment_venue" FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceMonthlyAdjustment" ADD CONSTRAINT "WorkforceMonthlyAdjustment_subject" FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceMonthlyAdjustment" ADD CONSTRAINT "WorkforceMonthlyAdjustment_actor" FOREIGN KEY ("tenantId","actorUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
CREATE TRIGGER "WorkforceMonthlyAdjustment_immutable" BEFORE UPDATE OR DELETE ON "WorkforceMonthlyAdjustment" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
ALTER TABLE "WorkforceNotification" ADD CONSTRAINT "WorkforceNotification_venue" FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotification" ADD CONSTRAINT "WorkforceNotification_subject" FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotification" ADD CONSTRAINT "WorkforceNotification_member" FOREIGN KEY ("tenantId","venueId","membershipId","userId") REFERENCES "Membership"("tenantId","venueId",id,"userId") ON DELETE RESTRICT;
CREATE TRIGGER "WorkforceNotification_immutable" BEFORE UPDATE OR DELETE ON "WorkforceNotification" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
ALTER TABLE "WorkforceNotificationReceipt" ADD CONSTRAINT "WorkforceNotificationReceipt_venue" FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationReceipt" ADD CONSTRAINT "WorkforceNotificationReceipt_subject" FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationPreference" ADD CONSTRAINT "WorkforceNotificationPreference_venue" FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationPreference" ADD CONSTRAINT "WorkforceNotificationPreference_subject" FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationPreference" ADD CONSTRAINT "WorkforceNotificationPreference_member" FOREIGN KEY ("tenantId","venueId","membershipId","userId") REFERENCES "Membership"("tenantId","venueId",id,"userId") ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationPreferenceRevision" ADD CONSTRAINT "WorkforceNotificationPreferenceRevision_venue" FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationPreferenceRevision" ADD CONSTRAINT "WorkforceNotificationPreferenceRevision_subject" FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationPreferenceRevision" ADD CONSTRAINT "WorkforceNotificationPreferenceRevision_actor" FOREIGN KEY ("tenantId","actorUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
CREATE TRIGGER "WorkforceNotificationPreferenceRevision_immutable" BEFORE UPDATE OR DELETE ON "WorkforceNotificationPreferenceRevision" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
ALTER TABLE "WorkforcePushSubscription" ADD CONSTRAINT "WorkforcePushSubscription_venue" FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforcePushSubscription" ADD CONSTRAINT "WorkforcePushSubscription_subject" FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforcePushSubscription" ADD CONSTRAINT "WorkforcePushSubscription_member" FOREIGN KEY ("tenantId","venueId","membershipId","userId") REFERENCES "Membership"("tenantId","venueId",id,"userId") ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationDelivery" ADD CONSTRAINT "WorkforceNotificationDelivery_venue" FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationDelivery" ADD CONSTRAINT "WorkforceNotificationDelivery_subject" FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationDeliveryAttempt" ADD CONSTRAINT "WorkforceNotificationDeliveryAttempt_venue" FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationDeliveryAttempt" ADD CONSTRAINT "WorkforceNotificationDeliveryAttempt_subject" FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
CREATE TRIGGER "WorkforceNotificationDeliveryAttempt_immutable" BEFORE UPDATE OR DELETE ON "WorkforceNotificationDeliveryAttempt" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
ALTER TABLE "WorkforceMonthlyClose" ADD CONSTRAINT wf3_close_profile FOREIGN KEY ("tenantId","venueId","profileId","userId","membershipId") REFERENCES "StaffProfile"("tenantId","venueId",id,"userId","membershipId") ON DELETE RESTRICT;
ALTER TABLE "WorkforceMonthlyClose" ADD CONSTRAINT wf3_close_audit FOREIGN KEY ("tenantId","venueId","auditEventId") REFERENCES "AuditEvent"("tenantId","venueId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceMonthlyAdjustment" ADD CONSTRAINT wf3_adjustment_close FOREIGN KEY ("tenantId","venueId","closeId","userId") REFERENCES "WorkforceMonthlyClose"("tenantId","venueId",id,"userId") ON DELETE RESTRICT;
ALTER TABLE "WorkforceMonthlyAdjustment" ADD CONSTRAINT wf3_adjustment_audit FOREIGN KEY ("tenantId","venueId","auditEventId") REFERENCES "AuditEvent"("tenantId","venueId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationReceipt" ADD CONSTRAINT wf3_receipt_notification FOREIGN KEY ("tenantId","venueId","notificationId","userId") REFERENCES "WorkforceNotification"("tenantId","venueId",id,"userId") ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationDelivery" ADD CONSTRAINT wf3_delivery_notification FOREIGN KEY ("tenantId","venueId","notificationId","userId") REFERENCES "WorkforceNotification"("tenantId","venueId",id,"userId") ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationDeliveryAttempt" ADD CONSTRAINT wf3_attempt_delivery FOREIGN KEY ("tenantId","venueId","deliveryId","userId") REFERENCES "WorkforceNotificationDelivery"("tenantId","venueId",id,"userId") ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationPreferenceRevision" ADD CONSTRAINT wf3_preference_history FOREIGN KEY ("tenantId","venueId","preferenceId","userId") REFERENCES "WorkforceNotificationPreference"("tenantId","venueId",id,"userId") ON DELETE RESTRICT;
ALTER TABLE "WorkforceNotificationDelivery" ADD CONSTRAINT wf3_delivery_subscription FOREIGN KEY ("tenantId","venueId","subscriptionId") REFERENCES "WorkforcePushSubscription"("tenantId","venueId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceAccountPolicy" ADD CONSTRAINT wf3_account_country CHECK ("countryCode" IN ('DE','AL') AND version>0);
ALTER TABLE "WorkforceMonthlyClose" ADD CONSTRAINT wf3_close_period CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$' AND version=1 AND "sourceHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "WorkforceMonthlyAdjustment" ADD CONSTRAINT wf3_adjustment_version CHECK (version>0 AND "sourceHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "WorkforceNotification" ADD CONSTRAINT wf3_notice_schema CHECK ("schemaVersion"=1 AND "requiredPermission" IN ('SELF','VENUE_MANAGER') AND locale IN ('sq','de','en','it'));
ALTER TABLE "WorkforceNotificationDelivery" ADD CONSTRAINT wf3_delivery_state CHECK (channel IN ('EMAIL','PUSH') AND state IN ('PENDING','LEASED','DELIVERED','DISABLED','FAILED','UNCERTAIN') AND "attemptCount">=0 AND version>=0);
ALTER TABLE "WorkforceNotificationDelivery" ADD CONSTRAINT wf3_delivery_lease CHECK ((state='LEASED' AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL) OR (state<>'LEASED' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL));
CREATE FUNCTION workforce_wf3_cursor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE excluded text[];
BEGIN
 IF TG_OP='DELETE' AND current_setting('flowgastronomie.test_cleanup',true)='on' THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Workforce evidence is retained'; END IF;
 IF TG_TABLE_NAME='WorkforceNotificationReceipt' THEN
  excluded:=ARRAY['version','readAt','acknowledgedAt','updatedAt'];
  IF OLD."readAt" IS NOT NULL AND NEW."readAt" IS DISTINCT FROM OLD."readAt" THEN RAISE EXCEPTION 'Read evidence cannot be reset'; END IF;
  IF OLD."acknowledgedAt" IS NOT NULL AND NEW."acknowledgedAt" IS DISTINCT FROM OLD."acknowledgedAt" THEN RAISE EXCEPTION 'Acknowledgment cannot be reset'; END IF;
 ELSIF TG_TABLE_NAME='WorkforceNotificationPreference' THEN
  excluded:=ARRAY['version','locale','emailEnabled','pushEnabled','reminderMinutes','categories','updatedAt'];
 ELSE
  excluded:=ARRAY['version','state','attemptCount','nextAttemptAt','leaseToken','leaseUntil','recipientAddress','subscriptionId','firstAttemptAt','lastCode','deliveredAt','updatedAt'];
  IF OLD."firstAttemptAt" IS NOT NULL AND NEW."firstAttemptAt" IS DISTINCT FROM OLD."firstAttemptAt" THEN RAISE EXCEPTION 'First delivery attempt is frozen'; END IF;
  IF OLD.state='DELIVERED'  THEN RAISE EXCEPTION 'Delivered notification cannot be replayed'; END IF;
  IF OLD."recipientAddress" IS NOT NULL AND NEW."recipientAddress" IS DISTINCT FROM OLD."recipientAddress" THEN RAISE EXCEPTION 'Delivery recipient is frozen'; END IF;
  IF OLD."subscriptionId" IS NOT NULL AND NEW."subscriptionId" IS DISTINCT FROM OLD."subscriptionId" THEN RAISE EXCEPTION 'Delivery subscription is frozen'; END IF;
 END IF;
 IF (to_jsonb(NEW)-excluded) IS DISTINCT FROM (to_jsonb(OLD)-excluded) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Workforce delivery/read cursor changed outside allowed versioned fields'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wf3_receipt_cursor BEFORE UPDATE OR DELETE ON "WorkforceNotificationReceipt" FOR EACH ROW EXECUTE FUNCTION workforce_wf3_cursor_guard();
CREATE TRIGGER wf3_preference_cursor BEFORE UPDATE OR DELETE ON "WorkforceNotificationPreference" FOR EACH ROW EXECUTE FUNCTION workforce_wf3_cursor_guard();
CREATE TRIGGER wf3_delivery_cursor BEFORE UPDATE OR DELETE ON "WorkforceNotificationDelivery" FOR EACH ROW EXECUTE FUNCTION workforce_wf3_cursor_guard();

-- A provider deduplication window begins at the first send attempt, not at an
-- old event's creation date. Frozen thereafter, including crash recovery.
ALTER TABLE "WorkforceNotificationDelivery" ADD COLUMN "firstAttemptAt" TIMESTAMP(3);

CREATE FUNCTION workforce_wf3_preference_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cursor_id text; cursor_version integer; history_version integer; cursor_payload jsonb; history_payload jsonb;
BEGIN
 cursor_id:=CASE WHEN TG_TABLE_NAME='WorkforceNotificationPreference' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'preferenceId' END;
 SELECT version,jsonb_build_object('locale',locale,'emailEnabled',"emailEnabled",'pushEnabled',"pushEnabled",'reminderMinutes',"reminderMinutes",'categories',categories) INTO cursor_version,cursor_payload FROM "WorkforceNotificationPreference" WHERE id=cursor_id;
 SELECT version,"after" INTO history_version,history_payload FROM "WorkforceNotificationPreferenceRevision" WHERE "preferenceId"=cursor_id ORDER BY version DESC LIMIT 1;
 IF cursor_version IS DISTINCT FROM history_version OR cursor_payload IS DISTINCT FROM history_payload THEN RAISE EXCEPTION 'Notification preference must match immutable consent history'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER wf3_preference_consistency AFTER INSERT OR UPDATE ON "WorkforceNotificationPreference" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce_wf3_preference_consistent();
CREATE CONSTRAINT TRIGGER wf3_consent_consistency AFTER INSERT ON "WorkforceNotificationPreferenceRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce_wf3_preference_consistent();
