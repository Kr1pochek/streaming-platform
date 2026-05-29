delete from track_tags duplicate_tag
using track_tags keeper_tag
where duplicate_tag.track_id = keeper_tag.track_id
  and duplicate_tag.ctid > keeper_tag.ctid
  and lower(duplicate_tag.tag) in ('трэп-метал', 'трэп метал')
  and lower(keeper_tag.tag) in ('трэп-метал', 'трэп метал');

delete from track_tags russian_tag
using track_tags english_tag
where russian_tag.track_id = english_tag.track_id
  and lower(russian_tag.tag) in ('трэп-метал', 'трэп метал')
  and lower(english_tag.tag) = 'trap metal';

update track_tags
set tag = 'trap metal'
where lower(tag) in ('трэп-метал', 'трэп метал');

delete from track_tags russian_tag
using track_tags english_tag
where russian_tag.track_id = english_tag.track_id
  and lower(russian_tag.tag) = 'трэп'
  and lower(english_tag.tag) = 'trap';

update track_tags
set tag = 'trap'
where lower(tag) = 'трэп';

delete from track_tags russian_tag
using track_tags english_tag
where russian_tag.track_id = english_tag.track_id
  and lower(russian_tag.tag) = 'рок'
  and lower(english_tag.tag) = 'rock';

update track_tags
set tag = 'rock'
where lower(tag) = 'рок';
