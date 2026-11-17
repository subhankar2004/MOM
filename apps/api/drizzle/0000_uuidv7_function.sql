-- UUIDv7 generator (RFC 9562): 48-bit Unix-ms timestamp + version 7 + random bits.
-- Built from gen_random_uuid() (a v4 UUID, whose variant bits are already correct):
-- the first 6 bytes are replaced by the timestamp, and bits 52/53 turn version 4 into 7.
-- PostgreSQL 18 ships uuidv7() natively; RDS for PostgreSQL 17 does not.
CREATE FUNCTION "uuid_generate_v7"() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid
$$;
