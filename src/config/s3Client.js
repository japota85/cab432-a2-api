import { S3Client } from "@aws-sdk/client-s3";

export const s3Client = new S3Client({
  region: "ap-southeast-2",
  credentials: undefined,
});
