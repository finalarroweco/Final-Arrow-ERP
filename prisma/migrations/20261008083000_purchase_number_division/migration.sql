CREATE OR REPLACE FUNCTION erp_purchase_document_number(prefix TEXT, source_id UUID) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
DECLARE n NUMERIC:=0; hex TEXT:=replace(source_id::text,'-',''); result TEXT:=''; i INTEGER; digit INTEGER;
BEGIN
 FOR i IN 1..32 LOOP n:=n*16+strpos('0123456789abcdef',substring(hex,i,1))-1;END LOOP;
 WHILE n>0 LOOP digit:=mod(n,36)::integer;result:=substring('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',digit+1,1)||result;n:=div(n,36);END LOOP;
 RETURN prefix||'-'||lpad(result,25,'0');
END $$;
