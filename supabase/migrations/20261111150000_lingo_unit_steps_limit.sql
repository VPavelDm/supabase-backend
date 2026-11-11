-- A unit's map has exactly three clearings for stumps: the apps place them at
-- three fixed spots on the map art, and a fourth step would be drawn on top of
-- the third. Edits to the lesson tables are live, so the database refuses a
-- fourth step in a unit rather than leaving it to content/lingo/check.ts.
--
-- Only the upper bound: a unit is filled one step at a time, so fewer than
-- three is allowed while editing (the clearings stay empty), and check.ts
-- reports a unit that is left that way.
--
-- An AFTER trigger, so the count includes the row being saved; it fires when a
-- step is added or moved to another unit.

create or replace function lingo.limit_unit_steps()
returns trigger
language plpgsql
set search_path to 'lingo'
as $$
begin
  if (select count(*) from unit_steps where unit_id = new.unit_id) > 3 then
    raise exception 'A unit has three stumps: unit % already has three steps', new.unit_id
      using hint = 'Put the lesson in another unit, or replace one of this unit''s steps.';
  end if;
  return null;
end;
$$;

drop trigger if exists unit_steps_limit on lingo.unit_steps;
create trigger unit_steps_limit
  after insert or update of unit_id on lingo.unit_steps
  for each row execute function lingo.limit_unit_steps();
