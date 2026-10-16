-- Slice 4 (Travel): itinerary times. A package item can start at a set time on its day
-- (07:00 shuttle, 10:00 boat ride); the itinerary and day-of reminders use it.
alter table public.package_items add column start_time time;
