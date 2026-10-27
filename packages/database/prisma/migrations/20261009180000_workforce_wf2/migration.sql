-- CreateTable
CREATE TABLE "WorkforcePolicy" (
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

    CONSTRAINT "WorkforcePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceAttendance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "contractRevisionId" TEXT,
    "policyRevisionId" TEXT NOT NULL,
    "publishedAssignmentRevisionId" TEXT,
    "operationalStaffShiftId" TEXT,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceAttendanceEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correctionRequestId" TEXT,

    CONSTRAINT "WorkforceAttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceAttendanceApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "attendanceVersion" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "calculation" JSONB NOT NULL,
    "sourceEventIds" TEXT[],
    "correctionRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforceAttendanceApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "contractRevisionId" TEXT,
    "policyRevisionId" TEXT NOT NULL,
    "invitedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkforceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceRequestTransition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforceRequestTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceLeaveGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "contractRevisionId" TEXT NOT NULL,
    "policyRevisionId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforceLeaveGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkforceEventIntent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "recipientUserIds" TEXT[],
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkforceEventIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkforcePolicy_tenantId_venueId_countryCode_effectiveFrom_idx" ON "WorkforcePolicy"("tenantId", "venueId", "countryCode", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforcePolicy_tenantId_venueId_id_key" ON "WorkforcePolicy"("tenantId", "venueId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforcePolicy_venueId_countryCode_version_key" ON "WorkforcePolicy"("venueId", "countryCode", "version");

-- CreateIndex
CREATE INDEX "WorkforceAttendance_tenantId_venueId_userId_startedAt_idx" ON "WorkforceAttendance"("tenantId", "venueId", "userId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkforceAttendance_tenantId_userId_state_idx" ON "WorkforceAttendance"("tenantId", "userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceAttendance_tenantId_venueId_id_key" ON "WorkforceAttendance"("tenantId", "venueId", "id");

-- CreateIndex
CREATE INDEX "WorkforceAttendanceEvent_tenantId_venueId_attendanceId_idx" ON "WorkforceAttendanceEvent"("tenantId", "venueId", "attendanceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceAttendanceEvent_tenantId_userId_idempotencyKey_key" ON "WorkforceAttendanceEvent"("tenantId", "userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceAttendanceEvent_attendanceId_sequence_key" ON "WorkforceAttendanceEvent"("attendanceId", "sequence");

-- CreateIndex
CREATE INDEX "WorkforceAttendanceApproval_tenantId_venueId_userId_idx" ON "WorkforceAttendanceApproval"("tenantId", "venueId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceAttendanceApproval_attendanceId_attendanceVersion_key" ON "WorkforceAttendanceApproval"("attendanceId", "attendanceVersion");

-- CreateIndex
CREATE INDEX "WorkforceRequest_tenantId_venueId_status_kind_idx" ON "WorkforceRequest"("tenantId", "venueId", "status", "kind");

-- CreateIndex
CREATE INDEX "WorkforceRequest_tenantId_userId_startsAt_endsAt_idx" ON "WorkforceRequest"("tenantId", "userId", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceRequest_tenantId_venueId_id_key" ON "WorkforceRequest"("tenantId", "venueId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceRequest_tenantId_userId_idempotencyKey_key" ON "WorkforceRequest"("tenantId", "userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WorkforceRequestTransition_tenantId_venueId_requestId_idx" ON "WorkforceRequestTransition"("tenantId", "venueId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceRequestTransition_requestId_version_key" ON "WorkforceRequestTransition"("requestId", "version");

-- CreateIndex
CREATE INDEX "WorkforceLeaveGrant_tenantId_venueId_userId_year_idx" ON "WorkforceLeaveGrant"("tenantId", "venueId", "userId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceLeaveGrant_tenantId_venueId_profileId_year_version_key" ON "WorkforceLeaveGrant"("tenantId", "venueId", "profileId", "year", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceLeaveGrant_tenantId_actorUserId_idempotencyKey_key" ON "WorkforceLeaveGrant"("tenantId", "actorUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WorkforceEventIntent_tenantId_venueId_subjectId_idx" ON "WorkforceEventIntent"("tenantId", "venueId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_tenantId_venueId_id_userId_membershipId_key" ON "StaffProfile"("tenantId", "venueId", "id", "userId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffShift_tenantId_venueId_userId_id_key" ON "StaffShift"("tenantId", "venueId", "userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StaffEmploymentContract_tenantId_venueId_profileId_id_key" ON "StaffEmploymentContract"("tenantId", "venueId", "profileId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedAssignmentRevision_tenantId_venueId_id_key" ON "PublishedAssignmentRevision"("tenantId", "venueId", "id");

-- AddForeignKey
ALTER TABLE "WorkforceAttendanceEvent" ADD CONSTRAINT "WorkforceAttendanceEvent_tenantId_venueId_attendanceId_fkey" FOREIGN KEY ("tenantId", "venueId", "attendanceId") REFERENCES "WorkforceAttendance"("tenantId", "venueId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforceAttendanceApproval" ADD CONSTRAINT "WorkforceAttendanceApproval_tenantId_venueId_attendanceId_fkey" FOREIGN KEY ("tenantId", "venueId", "attendanceId") REFERENCES "WorkforceAttendance"("tenantId", "venueId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkforceRequestTransition" ADD CONSTRAINT "WorkforceRequestTransition_tenantId_venueId_requestId_fkey" FOREIGN KEY ("tenantId", "venueId", "requestId") REFERENCES "WorkforceRequest"("tenantId", "venueId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only evidence, scope bindings and cross-venue active attendance guard.
CREATE UNIQUE INDEX workforce_one_active_user ON "WorkforceAttendance"("tenantId","userId") WHERE state <> 'CLOSED';
CREATE TRIGGER "WorkforcePolicy_immutable" BEFORE UPDATE OR DELETE ON "WorkforcePolicy" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
CREATE TRIGGER "WorkforceAttendanceEvent_immutable" BEFORE UPDATE OR DELETE ON "WorkforceAttendanceEvent" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
CREATE TRIGGER "WorkforceAttendanceApproval_immutable" BEFORE UPDATE OR DELETE ON "WorkforceAttendanceApproval" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
CREATE TRIGGER "WorkforceRequestTransition_immutable" BEFORE UPDATE OR DELETE ON "WorkforceRequestTransition" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
CREATE TRIGGER "WorkforceLeaveGrant_immutable" BEFORE UPDATE OR DELETE ON "WorkforceLeaveGrant" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
CREATE TRIGGER "WorkforceEventIntent_immutable" BEFORE UPDATE OR DELETE ON "WorkforceEventIntent" FOR EACH ROW EXECUTE FUNCTION workforce_history_immutable();
ALTER TABLE "WorkforceAttendance" ADD CONSTRAINT "WorkforceAttendance_canonical_profile" FOREIGN KEY ("tenantId","venueId","profileId","userId","membershipId") REFERENCES "StaffProfile"("tenantId","venueId",id,"userId","membershipId") ON DELETE RESTRICT;
ALTER TABLE "WorkforceAttendance" ADD CONSTRAINT "WorkforceAttendance_policy" FOREIGN KEY ("tenantId","venueId","policyRevisionId") REFERENCES "WorkforcePolicy"("tenantId","venueId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceAttendance" ADD CONSTRAINT "WorkforceAttendance_contract" FOREIGN KEY ("tenantId","venueId","profileId","contractRevisionId") REFERENCES "StaffEmploymentContract"("tenantId","venueId","profileId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceRequest" ADD CONSTRAINT "WorkforceRequest_canonical_profile" FOREIGN KEY ("tenantId","venueId","profileId","userId","membershipId") REFERENCES "StaffProfile"("tenantId","venueId",id,"userId","membershipId") ON DELETE RESTRICT;
ALTER TABLE "WorkforceRequest" ADD CONSTRAINT "WorkforceRequest_policy" FOREIGN KEY ("tenantId","venueId","policyRevisionId") REFERENCES "WorkforcePolicy"("tenantId","venueId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceRequest" ADD CONSTRAINT "WorkforceRequest_contract" FOREIGN KEY ("tenantId","venueId","profileId","contractRevisionId") REFERENCES "StaffEmploymentContract"("tenantId","venueId","profileId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceLeaveGrant" ADD CONSTRAINT "WorkforceLeaveGrant_canonical_profile" FOREIGN KEY ("tenantId","venueId","profileId","userId","membershipId") REFERENCES "StaffProfile"("tenantId","venueId",id,"userId","membershipId") ON DELETE RESTRICT;
ALTER TABLE "WorkforceLeaveGrant" ADD CONSTRAINT "WorkforceLeaveGrant_policy" FOREIGN KEY ("tenantId","venueId","policyRevisionId") REFERENCES "WorkforcePolicy"("tenantId","venueId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceLeaveGrant" ADD CONSTRAINT "WorkforceLeaveGrant_contract" FOREIGN KEY ("tenantId","venueId","profileId","contractRevisionId") REFERENCES "StaffEmploymentContract"("tenantId","venueId","profileId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceAttendance" ADD CONSTRAINT workforce_pos_link FOREIGN KEY ("tenantId","venueId","userId","operationalStaffShiftId") REFERENCES "StaffShift"("tenantId","venueId","userId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceAttendance" ADD CONSTRAINT workforce_publication_link FOREIGN KEY ("tenantId","venueId","publishedAssignmentRevisionId") REFERENCES "PublishedAssignmentRevision"("tenantId","venueId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforcePolicy" ADD CONSTRAINT workforce_policy_venue FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceEventIntent" ADD CONSTRAINT workforce_intent_venue FOREIGN KEY ("tenantId","venueId") REFERENCES "Venue"("tenantId",id) ON DELETE RESTRICT;
CREATE FUNCTION workforce_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND current_setting('flowgastronomie.test_cleanup',true)='on' THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Workforce evidence is retained'; END IF;
 IF TG_TABLE_NAME='WorkforceRequest' THEN
  IF (to_jsonb(NEW)-ARRAY['status','version','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updatedAt']) THEN RAISE EXCEPTION 'Original request evidence is immutable'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','version','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','updatedAt']) THEN RAISE EXCEPTION 'Original attendance evidence is immutable'; END IF;
 END IF;
 IF NEW.version <> OLD.version+1 THEN RAISE EXCEPTION 'Projection version must advance exactly once'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workforce_attendance_projection BEFORE UPDATE OR DELETE ON "WorkforceAttendance" FOR EACH ROW EXECUTE FUNCTION workforce_projection_guard();
CREATE TRIGGER workforce_request_projection BEFORE UPDATE OR DELETE ON "WorkforceRequest" FOR EACH ROW EXECUTE FUNCTION workforce_projection_guard();
ALTER TABLE "WorkforceAttendance" ADD CONSTRAINT workforce_attendance_state CHECK (state IN ('WORKING','BREAK','CLOSED'));
ALTER TABLE "WorkforceRequest" ADD CONSTRAINT workforce_request_status CHECK (status IN ('PENDING','ACCEPTED','APPROVED','REJECTED','CANCELLED'));

-- Deferred guards bind each mutable cursor to append-only evidence at commit.
CREATE FUNCTION workforce_cursor_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cursor_id text; current_version integer; current_state text; last_version integer; last_state text;
BEGIN
 IF TG_TABLE_NAME IN ('WorkforceAttendance','WorkforceAttendanceEvent') THEN
  cursor_id := CASE WHEN TG_TABLE_NAME='WorkforceAttendance' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'attendanceId' END;
  SELECT version,state INTO current_version,current_state FROM "WorkforceAttendance" WHERE id=cursor_id;
  SELECT sequence,CASE kind WHEN 'BREAK_START' THEN 'BREAK' WHEN 'CLOCK_OUT' THEN 'CLOSED' WHEN 'CORRECTION' THEN 'CLOSED' ELSE 'WORKING' END INTO last_version,last_state FROM "WorkforceAttendanceEvent" WHERE "attendanceId"=cursor_id ORDER BY sequence DESC LIMIT 1;
 ELSE
  cursor_id := CASE WHEN TG_TABLE_NAME='WorkforceRequest' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'requestId' END;
  SELECT version,status INTO current_version,current_state FROM "WorkforceRequest" WHERE id=cursor_id;
  SELECT version,"toStatus" INTO last_version,last_state FROM "WorkforceRequestTransition" WHERE "requestId"=cursor_id ORDER BY version DESC LIMIT 1;
 END IF;
 IF current_version IS DISTINCT FROM last_version OR current_state IS DISTINCT FROM last_state THEN RAISE EXCEPTION 'Workforce cursor must match immutable evidence'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER workforce_attendance_consistency AFTER INSERT OR UPDATE ON "WorkforceAttendance" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce_cursor_consistent();
CREATE CONSTRAINT TRIGGER workforce_event_consistency AFTER INSERT ON "WorkforceAttendanceEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce_cursor_consistent();
CREATE CONSTRAINT TRIGGER workforce_request_consistency AFTER INSERT OR UPDATE ON "WorkforceRequest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce_cursor_consistent();
CREATE CONSTRAINT TRIGGER workforce_transition_consistency AFTER INSERT ON "WorkforceRequestTransition" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workforce_cursor_consistent();
ALTER TABLE "WorkforceAttendanceEvent" ADD CONSTRAINT workforce_actual_kind CHECK (kind IN ('CLOCK_IN','BREAK_START','BREAK_END','CLOCK_OUT','CORRECTION') AND sequence > 0);

CREATE UNIQUE INDEX "WorkforceAttendance_tenantId_venueId_id_userId_key" ON "WorkforceAttendance"("tenantId","venueId",id,"userId");
ALTER TABLE "WorkforceAttendanceEvent" ADD CONSTRAINT "WorkforceAttendanceEvent_canonical_subject" FOREIGN KEY ("tenantId","venueId","attendanceId","userId") REFERENCES "WorkforceAttendance"("tenantId","venueId",id,"userId") ON DELETE RESTRICT;
ALTER TABLE "WorkforceAttendanceApproval" ADD CONSTRAINT "WorkforceAttendanceApproval_canonical_subject" FOREIGN KEY ("tenantId","venueId","attendanceId","userId") REFERENCES "WorkforceAttendance"("tenantId","venueId",id,"userId") ON DELETE RESTRICT;
ALTER TABLE "WorkforcePolicy" ADD CONSTRAINT "WorkforcePolicy_canonical_actor" FOREIGN KEY ("tenantId","createdByUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceAttendanceEvent" ADD CONSTRAINT "WorkforceAttendanceEvent_canonical_actor" FOREIGN KEY ("tenantId","actorUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceAttendanceApproval" ADD CONSTRAINT "WorkforceAttendanceApproval_canonical_actor" FOREIGN KEY ("tenantId","actorUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceRequestTransition" ADD CONSTRAINT "WorkforceRequestTransition_canonical_actor" FOREIGN KEY ("tenantId","actorUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceLeaveGrant" ADD CONSTRAINT "WorkforceLeaveGrant_canonical_actor" FOREIGN KEY ("tenantId","actorUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
ALTER TABLE "WorkforceEventIntent" ADD CONSTRAINT "WorkforceEventIntent_canonical_actor" FOREIGN KEY ("tenantId","actorUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT;
