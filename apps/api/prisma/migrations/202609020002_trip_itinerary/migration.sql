CREATE TYPE "TripStopType" AS ENUM ('MEETING', 'WAYPOINT', 'CAMPSITE', 'ATTRACTION', 'HOTEL', 'RETURN');
CREATE TYPE "TripTransportMode" AS ENUM ('DRIVING', 'RAIL', 'FLIGHT', 'WALKING', 'OTHER');
CREATE TYPE "TripRouteKind" AS ENUM ('PLANNED', 'SCHEMATIC');
CREATE TYPE "CoordinateSystem" AS ENUM ('GCJ02');

CREATE TABLE "TripStop" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "stopType" "TripStopType" NOT NULL,
  "latitude" DECIMAL(9,6) NOT NULL,
  "longitude" DECIMAL(9,6) NOT NULL,
  "coordSystem" "CoordinateSystem" NOT NULL DEFAULT 'GCJ02',
  "arriveAt" TIMESTAMP(3),
  "leaveAt" TIMESTAMP(3),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TripStop_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TripStop_latitude_check" CHECK ("latitude" BETWEEN -90 AND 90),
  CONSTRAINT "TripStop_longitude_check" CHECK ("longitude" BETWEEN -180 AND 180),
  CONSTRAINT "TripStop_time_check" CHECK ("leaveAt" IS NULL OR "arriveAt" IS NULL OR "leaveAt" >= "arriveAt")
);

CREATE TABLE "TripLeg" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "fromStopId" TEXT NOT NULL,
  "toStopId" TEXT NOT NULL,
  "mode" "TripTransportMode" NOT NULL,
  "routeKind" "TripRouteKind" NOT NULL DEFAULT 'SCHEMATIC',
  "geometryJson" JSONB,
  "coordSystem" "CoordinateSystem" NOT NULL DEFAULT 'GCJ02',
  "provider" TEXT,
  "distanceMeters" INTEGER,
  "durationSeconds" INTEGER,
  "staleAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TripLeg_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TripLeg_distinct_stops_check" CHECK ("fromStopId" <> "toStopId"),
  CONSTRAINT "TripLeg_distance_check" CHECK ("distanceMeters" IS NULL OR "distanceMeters" >= 0),
  CONSTRAINT "TripLeg_duration_check" CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0)
);

CREATE TABLE "Accommodation" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "stopId" TEXT,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "checkInDate" DATE NOT NULL,
  "checkOutDate" DATE NOT NULL,
  "contact" TEXT,
  "reservationNote" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Accommodation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Accommodation_dates_check" CHECK ("checkOutDate" > "checkInDate")
);

CREATE INDEX "TripStop_tripId_archivedAt_sortOrder_id_idx" ON "TripStop"("tripId", "archivedAt", "sortOrder", "id");
CREATE INDEX "TripLeg_tripId_archivedAt_createdAt_idx" ON "TripLeg"("tripId", "archivedAt", "createdAt");
CREATE INDEX "TripLeg_fromStopId_idx" ON "TripLeg"("fromStopId");
CREATE INDEX "TripLeg_toStopId_idx" ON "TripLeg"("toStopId");
CREATE INDEX "Accommodation_tripId_archivedAt_checkInDate_idx" ON "Accommodation"("tripId", "archivedAt", "checkInDate");
CREATE INDEX "Accommodation_stopId_idx" ON "Accommodation"("stopId");

ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripLeg" ADD CONSTRAINT "TripLeg_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripLeg" ADD CONSTRAINT "TripLeg_fromStopId_fkey" FOREIGN KEY ("fromStopId") REFERENCES "TripStop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TripLeg" ADD CONSTRAINT "TripLeg_toStopId_fkey" FOREIGN KEY ("toStopId") REFERENCES "TripStop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Accommodation" ADD CONSTRAINT "Accommodation_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Accommodation" ADD CONSTRAINT "Accommodation_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "TripStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
